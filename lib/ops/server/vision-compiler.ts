import { getProfile, resolveEndpointUrl } from "@/lib/ops/server/model-profiles"
import { describeRemoteError, detectProtocol, normalizeEndpoint, RemoteError } from "@/lib/ops/server/vlm-remote"
import { loadProfiles } from "@/lib/storage/model-store"
import { profileReadiness, type ModelProfile } from "@/lib/vigil/model-registry"
import { MAX_VOCABULARY, sanitizeVocabulary, type VisionRole, type VocabularyItem } from "@/lib/vigil/vision"

export interface CompileOutcome {
  source: "llm" | "fallback"
  model?: string
  note: string
  vocabulary: VocabularyItem[]
}

export class CompileError extends Error {}

const SYSTEM_PROMPT = `你是工业视觉检测系统的「检测词表编译器」。用户会用中文描述需要稽查的违规行为，你要把它翻译成开放词汇目标检测模型（YOLO-World）能识别的英文检测提示词。

只输出一个 JSON 对象，不要任何解释，格式：
{"vocabulary":[{"labelZh":"中文名","promptEn":"english noun phrase","role":"anchor_person|required_ppe|hazard_target"}]}

规则：
1. promptEn 必须是 2~6 个单词的英文名词短语，描述画面中肉眼可见的物体或状态，例如 "face mask on face"、"gloved hands"、"safety goggles"、"person using mobile phone"、"tool left on floor"。不要写句子、否定词（without/no/not）或动词短句。
2. role 含义：anchor_person=画面中的被检查人员（必须有 1 条）；required_ppe=人员必须穿戴的装备，缺失就违规（用户说「没戴/未戴/是否戴好」的装备都归这一类，写成装备本身，如 "safety goggles"）；hazard_target=只要出现就违规的物体或行为（手机、遗留工具、抹布、裸露皮肤、倚靠设备等）。
3. 总数不超过 ${MAX_VOCABULARY} 条，不要重复。labelZh 不超过 10 个汉字。`

function pickProfile(modelProfileId?: string): ModelProfile | null {
  const profile = modelProfileId ? getProfile(modelProfileId) : (loadProfiles().find((item) => item.isDefault && item.enabled) ?? null)
  if (!profile) return null
  return profileReadiness({ ...profile, hasKey: profile.apiKey.length > 0 }).ready ? profile : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : typeof asRecord(part)?.text === "string" ? (asRecord(part)?.text as string) : ""))
      .join("")
  }
  return ""
}

async function chatOnce(profile: ModelProfile, user: string, signal: AbortSignal): Promise<string> {
  const url = normalizeEndpoint(resolveEndpointUrl(profile))
  const protocol = detectProtocol(url)
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ]
  const body =
    protocol === "ollama"
      ? { model: profile.modelName, messages, stream: false, options: { temperature: 0.1 } }
      : protocol === "dashscope"
        ? { model: profile.modelName, input: { messages }, parameters: { result_format: "message", temperature: 0.1 } }
        : { model: profile.modelName, messages, stream: false, temperature: 0.1 }

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`

  let response: Response
  try {
    response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual", cache: "no-store", signal })
  } catch (error) {
    throw new RemoteError(describeRemoteError(error, url))
  }
  if (!response.ok) throw new RemoteError(`模型网关返回 HTTP ${response.status}`)
  const json = asRecord(await response.json().catch(() => null))
  if (!json) throw new RemoteError("模型网关返回的不是有效的 JSON")

  if (protocol === "ollama") return textOf(asRecord(json.message)?.content)
  if (protocol === "dashscope") {
    const output = asRecord(json.output)
    const choice = Array.isArray(output?.choices) ? asRecord(output.choices[0]) : null
    return textOf(asRecord(choice?.message)?.content) || (typeof output?.text === "string" ? output.text : "")
  }
  const choice = Array.isArray(json.choices) ? asRecord(json.choices[0]) : null
  return textOf(asRecord(choice?.message)?.content)
}

function parseVocabulary(text: string): VocabularyItem[] {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  const arrayStart = text.indexOf("[")
  let raw: unknown = null
  try {
    if (start >= 0 && end > start && (arrayStart < 0 || start < arrayStart)) raw = JSON.parse(text.slice(start, end + 1))
    else if (arrayStart >= 0) raw = JSON.parse(text.slice(arrayStart, text.lastIndexOf("]") + 1))
  } catch {
    throw new CompileError("模型返回的内容不是合法 JSON")
  }
  const list = Array.isArray(raw) ? raw : asRecord(raw)?.vocabulary
  const items = sanitizeVocabulary(list)
  if (!items || items.length === 0) throw new CompileError("模型没有给出任何可用的检测词条")
  return normalize(items)
}

/** 保证有主体锚点，按 锚点 → 必需劳保 → 违规目标 排序并重编 id。 */
function normalize(items: VocabularyItem[]): VocabularyItem[] {
  const order: Record<VisionRole, number> = { anchor_person: 0, required_ppe: 1, hazard_target: 2 }
  const list = [...items]
  if (!list.some((item) => item.role === "anchor_person")) {
    list.unshift({ id: "", labelZh: "人员", promptEn: "person", role: "anchor_person", enabled: true })
  }
  return list
    .sort((a, b) => order[a.role] - order[b.role])
    .slice(0, MAX_VOCABULARY)
    .map((item, index) => ({ ...item, id: `v${index + 1}`, enabled: true }))
}

/* ------------------------------ 离线词典兜底 ------------------------------ */

interface DictEntry {
  pattern: RegExp
  labelZh: string
  promptEn: string
  role: VisionRole
}

const DICTIONARY: DictEntry[] = [
  { pattern: /口罩/, labelZh: "口罩", promptEn: "face mask on face", role: "required_ppe" },
  { pattern: /手套/, labelZh: "手套", promptEn: "gloved hands", role: "required_ppe" },
  { pattern: /护目镜|防护眼镜/, labelZh: "护目镜", promptEn: "safety goggles", role: "required_ppe" },
  { pattern: /面罩/, labelZh: "面罩", promptEn: "face shield", role: "required_ppe" },
  { pattern: /洁净服|连体服|防护服|工作服/, labelZh: "洁净服", promptEn: "white cleanroom suit", role: "required_ppe" },
  { pattern: /头套|头罩|发帽|帽子/, labelZh: "头套", promptEn: "head hood covering hair", role: "required_ppe" },
  { pattern: /鞋套|洁净鞋|防护靴/, labelZh: "鞋套", promptEn: "cleanroom shoe covers", role: "required_ppe" },
  { pattern: /安全帽/, labelZh: "安全帽", promptEn: "hard hat", role: "required_ppe" },
  { pattern: /反光衣|反光背心|马甲/, labelZh: "反光衣", promptEn: "high visibility vest", role: "required_ppe" },
  { pattern: /裸露头发|头发外露|露发|头发裸露/, labelZh: "裸露头发", promptEn: "bare head with exposed hair", role: "hazard_target" },
  { pattern: /赤手|裸手|徒手/, labelZh: "裸手", promptEn: "bare hands without gloves", role: "hazard_target" },
  { pattern: /裸露皮肤|皮肤裸露|皮肤外露/, labelZh: "裸露皮肤", promptEn: "exposed skin", role: "hazard_target" },
  { pattern: /手机|玩手机|看手机/, labelZh: "使用手机", promptEn: "person using mobile phone", role: "hazard_target" },
  { pattern: /抹布|擦拭布/, labelZh: "遗留抹布", promptEn: "rag cloth on floor", role: "hazard_target" },
  { pattern: /工具|扳手|螺丝刀|遗落|遗留/, labelZh: "遗留工具", promptEn: "tool left on floor", role: "hazard_target" },
  { pattern: /倚靠|靠墙|靠在|依靠/, labelZh: "倚靠设备", promptEn: "person leaning on equipment", role: "hazard_target" },
  { pattern: /敞口|试剂瓶|开盖|容器未/, labelZh: "敞口容器", promptEn: "open bottle or unsealed container", role: "hazard_target" },
  { pattern: /饮料|食物|吃东西|喝水|水杯/, labelZh: "饮食", promptEn: "food or drink bottle", role: "hazard_target" },
  { pattern: /首饰|戒指|手表|饰品|耳环/, labelZh: "首饰手表", promptEn: "jewelry or wristwatch", role: "hazard_target" },
  { pattern: /明火|烟雾|冒烟/, labelZh: "明火烟雾", promptEn: "open flame or smoke", role: "hazard_target" },
  { pattern: /摔倒|倒地|躺在/, labelZh: "人员倒地", promptEn: "person lying on floor", role: "hazard_target" },
  { pattern: /奔跑|跑动|追逐/, labelZh: "奔跑", promptEn: "running person", role: "hazard_target" },
  { pattern: /泄漏|漏液|泼洒|积水/, labelZh: "液体泄漏", promptEn: "liquid spill on floor", role: "hazard_target" },
  { pattern: /纸箱|纸张|纸板/, labelZh: "纸箱纸张", promptEn: "cardboard box", role: "hazard_target" },
]

function compileByDictionary(instruction: string): VocabularyItem[] {
  const picked: VocabularyItem[] = []
  const seen = new Set<string>()
  for (const entry of DICTIONARY) {
    if (!entry.pattern.test(instruction) || seen.has(entry.promptEn)) continue
    seen.add(entry.promptEn)
    picked.push({ id: "", labelZh: entry.labelZh, promptEn: entry.promptEn, role: entry.role, enabled: true })
  }
  if (picked.length === 0) {
    throw new CompileError("无法从描述中识别出可检测的目标。请换一种说法（例如点名口罩、手套、手机、遗留工具），或先配置好模型网关使用 AI 解析")
  }
  const clean = /洁净/.test(instruction)
  picked.unshift({
    id: "",
    labelZh: clean ? "洁净服操作员" : "人员",
    promptEn: clean ? "person in white cleanroom suit" : "person",
    role: "anchor_person",
    enabled: true,
  })
  return normalize(picked)
}

export async function compileInstruction(instruction: string, modelProfileId: string | undefined, signal: AbortSignal): Promise<CompileOutcome> {
  const profile = pickProfile(modelProfileId)
  let fallbackReason = modelProfileId ? "所选模型尚未就绪" : "当前没有就绪的默认模型"

  if (profile) {
    try {
      const text = await chatOnce(profile, `请把下面的稽查要求编译成检测词表：\n${instruction}`, AbortSignal.any([signal, AbortSignal.timeout(30_000)]))
      const vocabulary = parseVocabulary(text)
      return { source: "llm", model: profile.modelName, note: `已由「${profile.name}」解析出 ${vocabulary.length} 个检测词条`, vocabulary }
    } catch (error) {
      if (signal.aborted) throw error
      fallbackReason = error instanceof Error ? error.message : "模型调用失败"
      console.error("[vision-compiler] LLM 编译失败，改用内置词典：", fallbackReason)
    }
  }

  const vocabulary = compileByDictionary(instruction)
  return { source: "fallback", note: `${fallbackReason}，已使用内置词典匹配出 ${vocabulary.length} 个词条（词典覆盖有限，建议连通模型网关后重新解析）`, vocabulary }
}
