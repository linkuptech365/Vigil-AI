/**
 * 自然语言视频检索的解析层：通道实体抽取（硬过滤）、目标类别抽取、标签二次校验与事件摘要生成。
 * 纯函数、无副作用，服务端接口与前端演示数据共用。
 */

export type SubjectKey = "person" | "cat" | "dog" | "vehicle"

interface SubjectDef {
  key: SubjectKey
  label: string
  /** 中文关键词，同时用于检索词与事件文本 */
  zh: string[]
  /** 英文检测标签 */
  en: string[]
}

const SUBJECTS: SubjectDef[] = [
  { key: "person", label: "人员", zh: ["人员", "行人", "工人", "员工", "访客", "男人", "女人", "人"], en: ["person", "people", "human", "man", "woman", "worker", "pedestrian"] },
  { key: "cat", label: "猫", zh: ["猫咪", "猫"], en: ["cat", "kitten", "feline"] },
  { key: "dog", label: "狗", zh: ["狗", "犬"], en: ["dog", "puppy", "canine"] },
  { key: "vehicle", label: "车辆", zh: ["车辆", "汽车", "货车", "叉车", "轿车", "卡车", "车"], en: ["car", "truck", "vehicle", "forklift", "van", "bus"] },
]

export const SUBJECT_LABEL: Record<SubjectKey, string> = Object.fromEntries(SUBJECTS.map((s) => [s.key, s.label])) as Record<SubjectKey, string>

/** 含“车/人”但并非目标类别的常见词，先摘掉再做类别识别 */
const NOT_SUBJECT_WORDS = ["车间", "车道", "车库", "车牌", "人工", "人脸", "无人", "人流", "出入口"]

function stripNonSubjectWords(text: string) {
  return NOT_SUBJECT_WORDS.reduce((acc, word) => acc.split(word).join(" "), text)
}

/** 从任意文本中识别目标类别；英文按单词边界匹配，避免 “cat” 命中 “locate”。 */
export function extractSubjects(text: string): SubjectKey[] {
  const clean = stripNonSubjectWords(text.toLowerCase())
  const found: SubjectKey[] = []
  for (const def of SUBJECTS) {
    const zhHit = def.zh.some((word) => clean.includes(word))
    const enHit = def.en.some((word) => new RegExp(`(^|[^a-z])${word}s?([^a-z]|$)`).test(clean))
    if (zhHit || enHit) found.push(def.key)
  }
  return found
}

/** 摘要里是否出现了“人员或猫”这类跨类别的并列/择一表述。 */
export function hasMixedSubjects(text: string) {
  return extractSubjects(text).length > 1
}

// ---------------------------------------------------------------------------
// 通道实体
// ---------------------------------------------------------------------------

export interface ChannelRef {
  id: string
  name: string
  zone?: string
}

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

function toNumber(raw: string) {
  if (/^\d+$/.test(raw)) return Number(raw)
  if (raw === "十") return 10
  if (raw.length === 2 && raw[0] === "十") return 10 + (CN_DIGITS[raw[1]] ?? 0)
  if (raw.length === 2 && raw[1] === "十") return (CN_DIGITS[raw[0]] ?? 0) * 10
  return CN_DIGITS[raw] ?? 0
}

const FLOOR_PATTERNS = [/([一二两三四五六七八九十\d]{1,3})\s*(?:楼|层|F(?![a-z]))/gi, /\bF\s*(\d{1,2})\b/gi]

/** 抽取文本里出现的楼层（“一楼 / 2楼 / 3F / 二层”均归一为数字）。 */
export function extractFloors(text: string): number[] {
  const floors = new Set<number>()
  for (const pattern of FLOOR_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const n = toNumber(match[1])
      if (n > 0) floors.add(n)
    }
  }
  return [...floors]
}

function squash(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "")
}

const CAM_PATTERN = /cam[-_\s]?0*(\d+)/gi

function camNumbers(text: string) {
  return [...text.matchAll(CAM_PATTERN)].map((m) => Number(m[1]))
}

export interface ChannelFilter {
  /** 识别出的通道别名短语（用于从检索词里剔除，也用于界面提示） */
  phrases: string[]
  /** 命中的通道 ID；null 表示 query 没有指定通道，不做过滤 */
  channelIds: string[] | null
  /** 指定了通道线索但没有任何通道匹配 */
  unresolved: boolean
}

export function extractChannelFilter(query: string, channels: ChannelRef[]): ChannelFilter {
  const phrases: string[] = []
  const floors = extractFloors(query)
  const cams = camNumbers(query)
  const squashedQuery = squash(query)

  for (const match of query.matchAll(/([一二两三四五六七八九十\d]{1,3})\s*(?:楼|层)|\bF\s*\d{1,2}\b|cam[-_\s]?\d+/gi)) {
    phrases.push(match[0])
  }

  const namedHits = channels.filter((channel) => {
    return [channel.name, channel.zone ?? ""].some((label) => {
      const key = squash(label)
      // 名称里的楼层不当作命名线索，交给楼层规则；至少两个字才算别名，避免单字误命中
      return key.length >= 2 && !/^[\d一二三四五六七八九十]*(楼|层)$/.test(key) && squashedQuery.includes(key)
    })
  })
  for (const channel of namedHits) {
    if (channel.name && squash(channel.name).length >= 2 && squashedQuery.includes(squash(channel.name))) phrases.push(channel.name)
    if (channel.zone && squash(channel.zone).length >= 2 && squashedQuery.includes(squash(channel.zone))) phrases.push(channel.zone)
  }

  const hasFloor = floors.length > 0
  const hasCam = cams.length > 0
  const hasName = namedHits.length > 0
  if (!hasFloor && !hasCam && !hasName) return { phrases, channelIds: null, unresolved: false }

  const byFloor = hasFloor
    ? channels.filter((channel) => extractFloors(`${channel.name} ${channel.zone ?? ""}`).some((f) => floors.includes(f)))
    : null
  const byCam = hasCam ? channels.filter((channel) => camNumbers(`${channel.id} ${channel.name}`).some((n) => cams.includes(n))) : null
  const byName = hasName ? namedHits : null

  // 多个线索同时出现时取交集，通道是硬条件，不做“放宽”
  const sets = [byFloor, byCam, byName].filter((set): set is ChannelRef[] => set !== null)
  const ids = sets
    .map((set) => new Set(set.map((c) => c.id)))
    .reduce((acc, next) => new Set([...acc].filter((id) => next.has(id))))
  return { phrases, channelIds: [...ids], unresolved: ids.size === 0 }
}

// ---------------------------------------------------------------------------
// 检索词解析
// ---------------------------------------------------------------------------

const STOP_WORDS = [
  "视频", "录像", "画面", "监控", "出现", "查找", "搜索", "检索", "寻找", "帮我", "请", "所有", "全部", "事件", "片段", "一下", "有没有", "是否", "显示", "给我", "的", "了", "过", "在", "有", "里", "中", "到", "和", "与",
]

export interface ParsedQuery {
  raw: string
  channel: ChannelFilter
  subjects: SubjectKey[]
  /** 去掉通道、类别与停用词后剩余的语义词（用于文本相关度） */
  terms: string[]
}

function residualTerms(query: string, phrases: string[], subjects: SubjectKey[]) {
  let text = query.toLowerCase()
  for (const phrase of phrases) text = text.split(phrase.toLowerCase()).join(" ")
  text = stripNonSubjectWords(text)
  for (const def of SUBJECTS.filter((s) => subjects.includes(s.key))) {
    for (const word of [...def.zh, ...def.en]) text = text.split(word).join(" ")
  }
  for (const word of STOP_WORDS) text = text.split(word).join(" ")
  return text
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .filter((part) => part.length >= 2 || /[a-z0-9]/.test(part))
    .filter(Boolean)
}

export function parseSearchQuery(query: string, channels: ChannelRef[]): ParsedQuery {
  const raw = query.trim()
  const channel = extractChannelFilter(raw, channels)
  // 通道别名里可能含“车间/一楼”之类字样，先摘掉再识别目标类别
  let forSubjects = raw
  for (const phrase of channel.phrases) forSubjects = forSubjects.split(phrase).join(" ")
  const subjects = extractSubjects(forSubjects)
  return { raw, channel, subjects, terms: residualTerms(raw, channel.phrases, subjects) }
}

// ---------------------------------------------------------------------------
// 事件标签与二次校验
// ---------------------------------------------------------------------------

export interface TaggableAlert {
  tags?: string[]
  ruleName?: string
  summary?: string
  edge?: { label?: string }
  fine?: { interaction_target?: { category?: string }; primary_action?: string }
}

/**
 * 事件关联的目标类别。优先级：入库时写入的 tags → 检测器标签 → 规则名 → 摘要。
 * 越靠前越接近“真实检出的单一主体”，一旦某一层有结果就不再混入后面的文本，防止跨实体撞库。
 */
export function alertSubjects(alert: TaggableAlert): SubjectKey[] {
  const stored = (alert.tags ?? []).flatMap((tag) => extractSubjects(tag))
  if (stored.length) return [...new Set(stored)]
  const layers = [alert.edge?.label, alert.ruleName, alert.summary]
  for (const layer of layers) {
    if (!layer) continue
    const found = extractSubjects(layer)
    if (found.length) return found
  }
  return []
}

/** 入库用：把单一主体写成 tags（类别 key + 中文名），供检索二次校验使用。 */
export function buildAlertTags(alert: TaggableAlert): string[] {
  return alertSubjects(alert).flatMap((key) => [key, SUBJECT_LABEL[key]])
}

export interface RerankInput {
  id: string
  channelId: string
  confidence: number
  subjects: SubjectKey[]
  text: string
}

export interface RerankOutput {
  score: number
  textOverlap: number
}

/** 返回 null 表示被硬过滤或二次校验剔除。score 为 0~1 的相似度。 */
export function scoreCandidate(parsed: ParsedQuery, item: RerankInput): RerankOutput | null {
  const { channel } = parsed
  if (channel.channelIds && !channel.channelIds.includes(item.channelId)) return null
  if (channel.unresolved) return null

  if (parsed.subjects.length > 0 && !parsed.subjects.some((s) => item.subjects.includes(s))) return null

  const haystack = item.text.toLowerCase()
  const overlap = parsed.terms.length ? parsed.terms.filter((term) => haystack.includes(term)).length / parsed.terms.length : 1
  if (parsed.terms.length > 0 && overlap === 0) return null

  const subjectBonus = parsed.subjects.length > 0 ? 0.06 : 0
  const confidence = item.confidence > 1 ? item.confidence / 100 : item.confidence
  const score = 0.5 + 0.25 * overlap + 0.18 * Math.min(1, Math.max(0, confidence)) + subjectBonus
  return { score: Math.round(Math.min(0.99, score) * 1000) / 1000, textOverlap: overlap }
}

// ---------------------------------------------------------------------------
// 展示
// ---------------------------------------------------------------------------

/** 兼容 0~1 小数与 0~100 百分数两种来源，统一输出整数百分比。 */
export function toPercent(score: number) {
  const value = score <= 1 ? score * 100 : score
  return Math.round(Math.min(100, Math.max(0, value)))
}

export function formatSimilarity(score: number) {
  return `${toPercent(score)}% 语义匹配`
}

// ---------------------------------------------------------------------------
// 事件摘要（入库）
// ---------------------------------------------------------------------------

const ACTION_ZH: Record<string, string> = {
  eating_kibble: "进食",
  eating: "进食",
  feeding: "进食",
  drinking_water: "饮水",
  drinking: "饮水",
  walking: "经过",
  loitering: "徘徊",
  falling: "摔倒",
  smoking: "吸烟",
  gowning_touch: "触碰洁净服",
}

const TARGET_ZH: Record<string, string> = {
  dry_food_tray: "食盆",
  food_bowl: "食盆",
  pet_feeder: "喂食器",
  feeder: "喂食器",
  water_dispenser: "饮水机",
  litter_box: "猫砂盆",
}

export interface SummaryInput {
  streamName: string
  zone?: string
  ruleName: string
  modelSummary: string
  detectedLabel?: string
  fine?: TaggableAlert["fine"]
}

/**
 * 事件摘要必须只描述真实检出的单一主体。
 * 当模型摘要把多个类别混在一起（如“人员或猫开始吃东西”），或与检测主体矛盾时，
 * 用检测主体 + 动作 + 交互物体重新生成；模型摘要干净时原样保留。
 */
export function composeEventSummary(input: SummaryInput): string {
  const subjects = alertSubjects({ edge: { label: input.detectedLabel }, ruleName: input.ruleName, summary: "" })
  const model = input.modelSummary.trim()
  if (subjects.length !== 1) return model || input.ruleName

  const [subject] = subjects
  const modelSubjects = extractSubjects(model)
  const polluted = modelSubjects.some((s) => s !== subject)
  if (model && !polluted) return model

  const action = ACTION_ZH[input.fine?.primary_action ?? ""]
  const target = TARGET_ZH[input.fine?.interaction_target?.category ?? ""]
  const where = input.zone && !input.streamName.includes(input.zone) ? `${input.streamName}（${input.zone}）` : input.streamName
  if (action) return `${where}${SUBJECT_LABEL[subject]}${target ? `在${target}` : ""}${action}`
  return `${where}检出${SUBJECT_LABEL[subject]}，触发「${input.ruleName}」`
}
