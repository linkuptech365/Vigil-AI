import { CAMERAS } from "./data"
import { KEYFRAME_OFFSETS } from "./ingestion-data"
import type { ClipReason, EscalationClip } from "./perception-types"
import type {
  RagCorpusEntry,
  RagSearchResult,
  VlmModelConfig,
  VlmReasoningResult,
  VlmScenario,
  VlmSeverity,
} from "./vlm-types"

export const VLM_MODELS: VlmModelConfig[] = [
  {
    id: "qwen2.5-vl-72b",
    name: "Qwen2.5-VL-72B (Default / Local Triton)",
    provider: "Alibaba Qwen · 本地 Triton 推理",
    latencyMs: 1180,
    contextWindow: "128K",
    costPer1kTokens: 0.00124,
  },
  {
    id: "gpt-4o-mini-video",
    name: "OpenAI GPT-4o Mini Video",
    provider: "OpenAI · 云端 API",
    latencyMs: 1650,
    contextWindow: "128K",
    costPer1kTokens: 0.0021,
  },
  {
    id: "gemini-1.5-flash",
    name: "Google Gemini 1.5 Flash",
    provider: "Google · 云端 API",
    latencyMs: 920,
    contextWindow: "1M",
    costPer1kTokens: 0.00095,
  },
  {
    id: "internvideo2-chat",
    name: "InternVideo2-Chat",
    provider: "上海 AI Lab · 本地部署",
    latencyMs: 1420,
    contextWindow: "32K",
    costPer1kTokens: 0.0006,
  },
]

const MODEL_TOKEN_PROFILE: Record<string, { prompt: number; completion: number; confidenceDelta: number }> = {
  "qwen2.5-vl-72b": { prompt: 2420, completion: 168, confidenceDelta: 0 },
  "gpt-4o-mini-video": { prompt: 2864, completion: 154, confidenceDelta: -2.8 },
  "gemini-1.5-flash": { prompt: 2310, completion: 182, confidenceDelta: -1.7 },
  "internvideo2-chat": { prompt: 1980, completion: 141, confidenceDelta: -4.3 },
}

const REASON_TOKEN_FACTOR: Record<ClipReason, number> = {
  fall_suspect: 1,
  roi_breach: 0.94,
  crowd_anomaly: 1.06,
}

const FRAME_MARKS = [3.2, 6.4, 9.6, 12.8, 16.0, 19.2, 21.6, 24.0]

export const FRAME_COUNT = FRAME_MARKS.length

export function frameMark(index: number) {
  const seconds = FRAME_MARKS[index] ?? 0
  return `00:${seconds.toFixed(1).padStart(4, "0")}`
}

export function frameTag(index: number) {
  const offset = KEYFRAME_OFFSETS[index] ?? 0
  if (offset === 0) return "T"
  return `T${offset > 0 ? "+" : ""}${offset}s`
}

export const SCENARIOS: Record<ClipReason, VlmScenario> = {
  fall_suspect: {
    title: "两人肢体冲突",
    cvSaw: "目标检测: 2人密集接触 / 运动向量突变",
    cvNote: "仅能确认「两人距离过近且发生剧烈位移」，无法区分友好接触、协作搬运与暴力行为，语义模糊，只能交由人工复核。",
    intent:
      "非日常友好交流。帧 4~7 目标 A 手部握拳挥击击中目标 B，目标 B 失去平衡倒地，两人随后持续肢体压制并伴随肢体反抗，判定为高风险暴力斗殴事件。",
    severity: "CRITICAL",
    baseConfidence: 94.6,
    clause: "违反厂区人身安全红线条例 第 3.2 款",
    chain: [
      "帧 1~3 (T-15s ~ T-5s)：两名作业人员在设备通道相向行走，肢体语言平稳，双手未持工具。",
      "帧 3~4：目标 A 与 B 距离缩短至 0.5m 以内，出现争执特征——手臂张开、上身前倾、头部相向。",
      "帧 4~5：目标 A 手部握拳挥击击中目标 B，目标 B 重心后仰、失去平衡并倒地。",
      "帧 6~7：双方持续肢体压制，目标 B 伴随明显挣扎与反抗，周边无第三方介入或劝阻。",
      "综合判断：行为序列符合「争执 → 挥击 → 倒地 → 压制」的暴力冲突因果链，排除嬉闹、协作搬运与医疗施救。",
    ],
    evidence: [3, 4, 5, 6],
    captions: [
      "两名作业人员沿通道相向走近，动作平稳",
      "双方停步交谈，目标 A 手势明显增大",
      "距离缩短至约 0.5m，目标 A 上身前倾",
      "目标 A 握拳挥击，击中目标 B",
      "目标 B 失去平衡，向后倒地",
      "目标 A 俯身压制，目标 B 肢体反抗",
      "持续压制，周边无人介入",
      "冲突仍在持续，画面内暂无安保到场",
    ],
    actions: ["声光报警并推送钉钉/企微至安保值班长", "自动锁定前后 60 秒原始码流用于取证", "联动调取最近安保岗位画面"],
  },
  roi_breach: {
    title: "红线禁区入侵",
    cvSaw: "目标检测: 1人 ROI 越界 / 轨迹穿越电子围栏",
    cvNote: "仅能判定「目标进入围栏多边形」，无法判断是授权巡检、停机维护，还是无防护的擅自闯入。",
    intent:
      "非授权擅入。目标全程未佩戴安全帽，绕过警示隔离带径直进入设备回转半径，停留超过 6 秒且无同行监护人员，判定为严重违反禁区管理规定的入侵行为。",
    severity: "CRITICAL",
    baseConfidence: 93.1,
    clause: "违反设备作业区安全距离管理规定 第 2.4 款",
    chain: [
      "帧 1~2：目标沿通道正常行走，距离警戒线约 2.5m，行进方向朝向设备作业区。",
      "帧 3：目标越过黄色警戒线并进入电子围栏多边形，未做任何停顿或观察。",
      "帧 4~5：目标在设备回转半径内停留，头部无安全帽，手部未持作业凭证或检修工具。",
      "帧 6~8：目标持续停留，无监护人员同行，周边设备仍处于运行状态。",
      "综合判断：满足「无防护 + 无监护 + 运行设备禁区」三项叠加，排除授权巡检与停机维护。",
    ],
    evidence: [2, 3, 4],
    captions: [
      "目标沿通道行走，尚在警戒线外",
      "目标逐渐靠近警戒线，朝向设备区",
      "目标跨越黄色警戒线",
      "目标进入电子围栏区域，未佩戴安全帽",
      "目标停留在设备回转半径内",
      "停留持续，无监护人员同行",
      "设备仍在运行，目标未撤离",
      "目标继续滞留禁区",
    ],
    actions: ["声光报警并语音喊话驱离", "推送告警至车间主任与安全员", "自动联动设备减速/急停预案"],
  },
  crowd_anomaly: {
    title: "通道人员异常聚集",
    cvSaw: "目标检测: 4人聚集 / 停留时长异常",
    cvNote: "仅能识别「多人距离过近」，无法判断是班前会、协同搬运，还是阻塞通道的违规聚集。",
    intent:
      "非作业性聚集。4 名人员在叉车主通道中央围拢停留超过 20 秒，无搬运或盘点动作，且正对叉车来向，阻塞物流动线并存在碰撞风险，判定为需干预的聚集隐患。",
    severity: "WARNING",
    baseConfidence: 87.4,
    clause: "违反仓储物流通道通行规范 第 5.1 款",
    chain: [
      "帧 1~2：通道内陆续有人员靠近，首位人员停步，其余人员向其聚拢。",
      "帧 3~4：4 人在通道中央围成半圆，彼此交谈，手中无货物、扫码枪或搬运工具。",
      "帧 5~6：叉车从通道另一端驶近，聚集人群未让行，叉车被迫减速。",
      "帧 7~8：聚集持续，物流动线被阻塞，存在叉车与行人碰撞风险。",
      "综合判断：非作业性聚集叠加叉车来向，属于需现场干预的一般预警。",
    ],
    evidence: [3, 4, 5],
    captions: [
      "通道内人员陆续走近",
      "首位人员停步，其余人员聚拢",
      "4 人在通道中央围成半圆",
      "多人交谈，无搬运或盘点动作",
      "叉车自通道另一端驶近",
      "人群未让行，叉车被迫减速",
      "聚集持续，物流动线被阻塞",
      "存在叉车与行人碰撞风险",
    ],
    actions: ["推送语音广播提示疏散通道", "通知仓储班组长现场确认", "叉车端同步限速提示"],
  },
}

export function severityLabel(severity: VlmSeverity) {
  if (severity === "CRITICAL") return "CRITICAL (严重违规)"
  if (severity === "WARNING") return "WARNING (一般预警)"
  return "SAFE (合规)"
}

export function eventIdOf(clip: EscalationClip) {
  const time = clip.time.replace(/:/g, "")
  return `EVT-${clip.cameraId.replace("-", "")}-${time.slice(0, 4)}`
}

export function candidateLabel(clip: EscalationClip) {
  const camera = CAMERAS.find((c) => c.id === clip.cameraId)
  return `${eventIdOf(clip)}: ${camera?.name ?? clip.cameraId} · ${SCENARIOS[clip.reason].title}`
}

export function buildResult(clip: EscalationClip, model: VlmModelConfig): VlmReasoningResult {
  const scenario = SCENARIOS[clip.reason]
  const profile = MODEL_TOKEN_PROFILE[model.id] ?? MODEL_TOKEN_PROFILE["qwen2.5-vl-72b"]
  const factor = REASON_TOKEN_FACTOR[clip.reason]
  const prompt = Math.round(profile.prompt * factor)
  const completion = Math.round(profile.completion * factor)
  const totalCost = ((prompt + completion) / 1000) * model.costPer1kTokens
  const confidence = Math.round((scenario.baseConfidence + profile.confidenceDelta) * 10) / 10
  const eventId = eventIdOf(clip)

  return {
    eventId,
    channelId: clip.cameraId,
    modelUsed: model.name,
    confidence,
    severity: scenario.severity,
    summary: scenario.intent,
    reasoningChain: scenario.chain,
    evidenceKeyframes: scenario.evidence,
    tokenUsage: { prompt, completion, totalCost },
    rawJson: {
      schema_version: "vigil.vlm.v1",
      event_id: eventId,
      channel_id: clip.cameraId,
      source_clip: clip.id,
      model: model.name,
      severity: scenario.severity,
      confidence: confidence / 100,
      behavior: {
        type: scenario.title,
        intent: scenario.intent,
      },
      evidence_keyframes: scenario.evidence.map((i) => ({
        index: i + 1,
        offset: frameTag(i),
        timestamp: frameMark(i),
      })),
      violated_clause: scenario.clause,
      recommended_actions: scenario.actions,
      tier1_trigger: clip.reason,
      token_usage: { prompt, completion },
      latency_ms: model.latencyMs,
      human_review_required: scenario.severity === "CRITICAL",
    },
  }
}

export function composeStreamText(result: VlmReasoningResult, scenario: VlmScenario) {
  const summary = JSON.stringify(
    {
      severity: result.severity,
      confidence: result.confidence / 100,
      evidence_keyframes: result.evidenceKeyframes.map((i) => i + 1),
      violated_clause: scenario.clause,
    },
    null,
    2
  )

  return [
    "### 时序观察",
    ...result.reasoningChain.slice(0, -1).map((line) => `- ${line}`),
    "",
    "### 行为意图研判",
    result.summary,
    "",
    "### 研判结论",
    `${result.reasoningChain[result.reasoningChain.length - 1]}`,
    "",
    "```json",
    summary,
    "```",
  ].join("\n")
}

export const RAG_INDEX = {
  clips: 1280,
  dimensions: "1024-dim",
  embedding: "EVA-CLIP / Video-LLaVA Embedding",
  store: "Milvus / Qdrant (Simulated Edge Node)",
}

export const RAG_PRESETS = [
  "查找今天上午穿黄色反光衣骑叉车的人",
  "检索所有两人肢体冲突推搡片段",
  "寻找在危化品罐区抽烟或玩手机的行为",
  "查找未戴头盔在机床周围滞留超过2分钟的人",
]

const camName = (id: string) => CAMERAS.find((c) => c.id === id)?.name ?? id
const camImage = (id: string) => CAMERAS.find((c) => c.id === id)?.image ?? ""

const entry = (
  id: string,
  channelId: string,
  timeRange: string,
  matchedText: string,
  keywords: string[]
): RagCorpusEntry => ({
  id,
  channelId,
  channelName: camName(channelId),
  timeRange,
  thumbnail: camImage(channelId),
  matchedText,
  keywords,
})

export const RAG_CORPUS: RagCorpusEntry[] = [
  entry(
    "CAM04_20261020_091812.mp4",
    "CAM-04",
    "09:18:12 - 09:18:32",
    "在第 09:18:20 帧检索到黄色反光衣与叉车操作动作，语义特征与检索描述高度契合。",
    ["叉车", "黄色", "反光衣", "上午", "骑", "驾驶", "仓储", "操作"]
  ),
  entry(
    "CAM01_20261020_085204.mp4",
    "CAM-01",
    "08:52:04 - 08:52:24",
    "在第 08:52:13 帧检索到身穿黄色反光衣的人员通过东门通道，与叉车同框，语义部分契合。",
    ["黄色", "反光衣", "上午", "东门", "通行", "人员", "叉车"]
  ),
  entry(
    "CAM02_20261020_140807.mp4",
    "CAM-02",
    "14:08:07 - 14:08:27",
    "在第 14:08:15 帧检索到两人近距离肢体对抗，目标 A 挥击后目标 B 倒地，与肢体冲突描述高度一致。",
    ["冲突", "推搡", "肢体", "打架", "斗殴", "两人", "搏斗", "拉扯", "争执"]
  ),
  entry(
    "CAM04_20261020_114230.mp4",
    "CAM-04",
    "11:42:30 - 11:42:50",
    "在第 11:42:38 帧检索到两名人员在通道内互相推搡，随后被第三人拉开，属于轻度肢体冲突。",
    ["推搡", "冲突", "肢体", "两人", "拉扯", "争执", "通道"]
  ),
  entry(
    "CAM03_20261020_132541.mp4",
    "CAM-03",
    "13:25:41 - 13:26:01",
    "在第 13:25:49 帧检索到人员在储罐围栏内手持香烟，面部有吸烟动作，位于危化品禁烟区域。",
    ["抽烟", "吸烟", "危化品", "罐区", "香烟", "储罐", "禁烟"]
  ),
  entry(
    "CAM03_20261020_150210.mp4",
    "CAM-03",
    "15:02:10 - 15:02:30",
    "在第 15:02:19 帧检索到人员低头使用手机，站位邻近储罐阀门区，与玩手机描述高度契合。",
    ["玩手机", "手机", "危化品", "罐区", "低头", "储罐", "分心"]
  ),
  entry(
    "CAM02_20261020_103604.mp4",
    "CAM-02",
    "10:36:04 - 10:38:20",
    "在第 10:37:02 帧检索到未佩戴安全帽人员在机床周围持续徘徊，滞留总时长约 2 分 16 秒。",
    ["未戴", "头盔", "安全帽", "机床", "滞留", "停留", "2分钟", "围绕", "徘徊", "车间"]
  ),
  entry(
    "CAM04_20261020_162955.mp4",
    "CAM-04",
    "16:29:55 - 16:30:15",
    "在第 16:30:03 帧检索到多名人员在叉车主通道中央围拢停留，物流动线被阻塞。",
    ["聚集", "围拢", "停留", "通道", "人群", "多人", "滞留", "叉车"]
  ),
]

function stableNoise(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return (hash % 40) / 10
}

export const RAG_THRESHOLD = 65

export function searchCorpus(query: string): RagSearchResult[] {
  const text = query.trim()
  if (!text) return []

  return RAG_CORPUS.map(({ keywords, ...rest }) => {
    const hits = keywords.filter((keyword) => text.includes(keyword)).length
    if (hits === 0) return { ...rest, similarityScore: 0 }
    const score = Math.min(98.6, 62 + hits * 8 + stableNoise(rest.id + text))
    return { ...rest, similarityScore: Math.round(score * 10) / 10 }
  })
    .filter((item) => item.similarityScore >= RAG_THRESHOLD)
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, 4)
}
