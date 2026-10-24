export const STREAM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/i
export const RESERVED_STREAM_IDS: readonly string[] = ["engine"]
export const DEMO_STREAM_ID = "cleanroom_demo_loop"

export const STREAM_ZONES = ["A 级洁净区", "B 级洁净区", "C 级洁净区", "D 级洁净区", "更衣缓冲区", "公共区域"] as const

export type EngineStatus = "running" | "starting" | "degraded"
export type EngineIssue = "binary-missing" | "crashed" | "unreachable" | "disabled" | "unsupported"

export interface EngineInfo {
  engineStatus: EngineStatus
  issue?: EngineIssue
  /** 面向用户的状态说明与修复建议 */
  message: string
  binaryReady: boolean
  /** 当前平台对应的 go2rtc 资产名，如 linux-x64；不支持的平台为空 */
  platform: string
  version?: string
  restarts: number
  /** 引擎是否由本服务拉起；false 表示接管了已在运行的外部实例 */
  managed: boolean
}

export type StreamLinkStatus = "online" | "offline" | "idle"

export interface StreamLastAnalysis {
  at: string
  status: "safe" | "alert" | "error"
  ruleName?: string
  confidence?: number
  summary?: string
  alertId?: string
}

export interface StreamMeta {
  id: string
  name: string
  zone: string
  /** 原始拉流地址，含凭证，仅服务端持有；内置模拟流为空 */
  source: string
  builtin: boolean
  autoPatrol: boolean
  createdAt: string
  lastAnalysis?: StreamLastAnalysis
}

export interface StreamView {
  id: string
  name: string
  zone: string
  /** 已脱敏的地址（密码以 •••• 替代） */
  sourceMasked: string
  builtin: boolean
  autoPatrol: boolean
  status: StreamLinkStatus
  consumers: number
  createdAt: string
  lastAnalysis?: StreamLastAnalysis
}

export interface StreamsResponse {
  status: "success"
  engine: EngineInfo
  streams: StreamView[]
  onlineCount: number
}

export interface StreamTestResult {
  ok: boolean
  latencyMs: number
  bytes?: number
  message: string
}

export type StreamAlertSource = "stream" | "edge"

export const ALERT_SOURCE_LABEL: Record<StreamAlertSource | "offline", string> = {
  stream: "实时监控通道",
  edge: "边缘初筛触发",
  offline: "离线录像文件",
}

export interface StreamAlertFrame {
  index: number
  timecode: string
  capturedAt: string
}

export type CaseStatus = "PENDING" | "ACKED" | "DISPATCHED" | "IN_PROGRESS" | "RESOLVED" | "FALSE_POSITIVE"

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  PENDING: "待处置",
  ACKED: "已确认",
  DISPATCHED: "已派工",
  IN_PROGRESS: "处置中",
  RESOLVED: "已结案",
  FALSE_POSITIVE: "误报",
}

export interface CaseAction {
  id: string
  at: string
  operator: string
  actionType: string
  notes: string
}

export type LinkageChannel = "SIREN" | "WEBHOOK" | "IM_BOT" | "IOT_HARDWARE"

export const LINKAGE_CHANNELS: { channel: LinkageChannel; name: string; env: string; criticalOnly: boolean }[] = [
  { channel: "WEBHOOK", name: "业务系统 Webhook", env: "VIGIL_LINKAGE_WEBHOOK_URL", criticalOnly: false },
  { channel: "IM_BOT", name: "IM 机器人（飞书 / 钉钉 / 企微）", env: "VIGIL_LINKAGE_IM_URL", criticalOnly: false },
  { channel: "SIREN", name: "现场声光警号", env: "VIGIL_LINKAGE_SIREN_URL", criticalOnly: true },
  { channel: "IOT_HARDWARE", name: "IoT 闸机 / 门禁联锁", env: "VIGIL_LINKAGE_IOT_URL", criticalOnly: true },
]

export interface LinkageResult {
  channel: LinkageChannel
  name: string
  status: "SUCCESS" | "FAILED" | "NOT_CONFIGURED" | "SKIPPED"
  firedAt?: string
  detail?: string
}

export type FalsePositiveReasonCode = "LIGHT_CHANGE" | "OCCLUSION" | "OBJECT_MISJUDGED" | "OTHER"

export interface AlertCase {
  caseId: string
  status: CaseStatus
  responder?: string
  actions: CaseAction[]
  linkage: LinkageResult[]
  falsePositive?: { reason: FalsePositiveReasonCode; explanation: string; submittedAt: string }
  closedAt?: string
}

export interface EvidenceFileSeal {
  name: string
  sha256: string
  bytes: number
}

export interface EvidenceSeal {
  algorithm: "SHA-256"
  sealedAt: string
  /** 对告警研判记录（不含处置过程）规范化 JSON 的哈希 */
  recordHash: string
  files: EvidenceFileSeal[]
}

export interface EvidenceIntegrity {
  ok: boolean
  checkedAt: string
  missing: string[]
  tampered: string[]
  recordMatches: boolean
}

export type AnalysisOutcome = "alert" | "safe" | "folded" | "error"

/** 每一次研判都会落一条记录：命中、否决、被冷却折叠、失败都有迹可循。 */
export interface StreamAnalysisRecord {
  id: string
  at: string
  streamId: string
  streamName: string
  source: StreamAlertSource
  outcome: AnalysisOutcome
  ruleName?: string
  confidence?: number
  summary: string
  /** 否决 / 折叠 / 失败的具体原因 */
  reason?: string
  alertId?: string
  edge?: { trackId: string; edgeConfidence: number; label?: string }
  /** 边缘高置信但被大模型否决，值得回流为困难样本 */
  hardSample?: boolean
  /** 同一失败原因在短时间内重复出现的次数 */
  count?: number
}

export interface StreamAlert {
  id: string
  source: StreamAlertSource
  streamId: string
  streamName: string
  zone: string
  triggeredAt: string
  ruleId: string
  ruleName: string
  severity: "INFO" | "WARNING" | "CRITICAL"
  confidence: number
  summary: string
  reasoning: string
  advice: string
  frames: StreamAlertFrame[]
  evidenceKeyframes: number[]
  model: string
  engineSource: "remote" | "fallback"
  edge?: { trackId: string; edgeConfidence: number; label?: string }
  case?: AlertCase
  seal?: EvidenceSeal
}

export interface StreamAlertsResponse {
  status: "success"
  alerts: StreamAlert[]
  records: StreamAnalysisRecord[]
}

export interface AnalyzeStreamResponse {
  status: "success"
  verdict: "alert" | "safe"
  summary: string
  confidence: number
  ruleName: string | null
  alert: StreamAlert | null
  frameCount: number
  model: string
  engineSource: "remote" | "fallback"
}

export const RTSP_TEMPLATES = [
  {
    id: "hik-main",
    label: "海康 NVR 主码流",
    url: "rtsp://admin:password@192.168.1.64:554/Streaming/Channels/101",
  },
  {
    id: "hik-sub",
    label: "海康 NVR 子码流",
    url: "rtsp://admin:password@192.168.1.64:554/Streaming/Channels/102",
  },
  {
    id: "demo-loop",
    label: "本地模拟循环推流",
    url: `rtsp://127.0.0.1:8554/${DEMO_STREAM_ID}`,
  },
] as const

const SOURCE_PROTOCOLS = new Set(["rtsp:", "rtsps:", "rtmp:", "http:", "https:"])

/** 只放行常规拉流协议，拒绝 exec:/ffmpeg: 等会在宿主机执行命令的 go2rtc 源。返回错误文案，合法时返回 null。 */
export function validateSourceUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return "请填写 RTSP 视频流地址"
  if (value.length > 512) return "视频流地址过长（最多 512 个字符）"
  if (/\s/.test(value)) return "视频流地址不能包含空白字符"
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return "视频流地址格式无效，应形如 rtsp://用户名:密码@IP:554/Streaming/Channels/101"
  }
  if (!SOURCE_PROTOCOLS.has(url.protocol)) return "仅支持 rtsp / rtsps / rtmp / http(s) 协议的视频流地址"
  if (!url.hostname) return "视频流地址缺少主机名"
  return null
}

export function maskRtspUrl(raw: string) {
  return raw.replace(/\/\/([^/@:\s]+):[^/@\s]*@/, "//$1:••••@")
}

export function slugifyStreamId(name: string) {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
  const suffix = Math.random().toString(36).slice(2, 7)
  return `${ascii || "cam"}-${suffix}`
}
