import type {
  ChannelBroadcastStatus,
  DispatchAction,
  DossierStatus,
  EvidenceDossier,
  FalsePositiveReason,
  KeyframeMeta,
  QuickActionType,
  Responder,
} from "./dispatch-types"

export const CLIP_SECONDS = 30
export const CLIP_FPS = 25
export const CLIP_T0 = 15
export const WORKSHOP_IMAGE = "/ops/cam-02-workshop.png"

export const INITIAL_DOSSIER: EvidenceDossier = {
  dossierId: "DOS-20261020-008",
  incidentId: "INC-20261020-0417",
  channelId: "CAM-02",
  channelName: "1号重型机加工车间",
  title: "DOS-20261020-008: 1号机加工车间越界入侵与肢体冲突案卷",
  timestamp: "2026-10-20 14:32:08",
  severity: "CRITICAL",
  clipDuration: "00:30 (T-15s ~ T+15s)",
  clipSize: "18.4 MB",
  keyframes: Array.from({ length: 8 }, () => WORKSHOP_IMAGE),
  sha256Hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  violatedClauses: [
    "厂区安全生产规程第 4.2 条：重型设备作业半径内严禁无关人员停留",
    "厂区安全生产规程第 7.5 条：作业区域内严禁肢体冲突与推搡",
  ],
  status: "PENDING",
}

export const KEYFRAMES: KeyframeMeta[] = [
  { id: "KF-1", offsetSec: -12, label: "人员进入画面", breach: false, box: [8, 52, 11, 26], confidence: 0.91 },
  { id: "KF-2", offsetSec: -8, label: "沿通道接近设备", breach: false, box: [20, 50, 11, 27], confidence: 0.93 },
  { id: "KF-3", offsetSec: -4, label: "靠近黄线边界", breach: false, box: [34, 49, 12, 28], confidence: 0.94 },
  { id: "KF-4", offsetSec: -1, label: "足部压线", breach: true, box: [44, 48, 12, 29], confidence: 0.96 },
  { id: "KF-5", offsetSec: 0, label: "越界进入危险区", breach: true, box: [49, 47, 13, 30], confidence: 0.97 },
  { id: "KF-6", offsetSec: 2, label: "两人肢体接触", breach: true, box: [50, 45, 22, 32], confidence: 0.95 },
  { id: "KF-7", offsetSec: 5, label: "推搡与拉扯", breach: true, box: [52, 44, 24, 33], confidence: 0.94 },
  { id: "KF-8", offsetSec: 9, label: "冲突持续，人员未撤离", breach: false, box: [53, 44, 24, 33], confidence: 0.92 },
]

export const RESPONDERS: Responder[] = [
  { id: "east-gate", name: "东门安保 1 组", role: "张队长" },
  { id: "workshop-owner", name: "车间安全责任人", role: "李工" },
  { id: "medical", name: "驻厂医护急救组", role: "值班医生" },
]

export const SUMMARY_OVERVIEW =
  "14:32:08，1号重型机加工车间检测到 1 名无关人员越过地面黄线进入龙门铣设备作业半径，约 2 秒后与另 1 名作业人员发生推搡与肢体拉扯，冲突持续超过 6 秒，未见现场人员介入。"

export const SUMMARY_CAUSAL_CHAIN = [
  "一级感知：ROI「设备危险半径」触发入侵事件，目标置信度 0.97。",
  "二级研判：多模态大模型识别两人距离小于 0.5 米且存在手臂拉扯动作，判定为肢体冲突。",
  "规则引擎：命中「人员聚集推搡预警」，冷却窗口外首次触发，升级为 CRITICAL 工单。",
]

export const FALSE_POSITIVE_REASONS: Record<FalsePositiveReason, string> = {
  LIGHT_CHANGE: "光影变化误认",
  VEST_OCCLUSION: "反光背心遮挡",
  TOOL_MISJUDGED: "常规搬运工具误判为武器/斗殴",
  OTHER: "其他",
}

export const STATUS_LABEL: Record<DossierStatus, string> = {
  PENDING: "待处置",
  DISPATCHED: "已派工",
  IN_PROGRESS: "处置中",
  RESOLVED: "已结案",
  FALSE_POSITIVE: "已标记误报并入库微调集 (Dataset Exported)",
}

export const STATUS_SHORT_LABEL: Record<DossierStatus, string> = {
  PENDING: "待处置",
  DISPATCHED: "已派工",
  IN_PROGRESS: "处置中",
  RESOLVED: "已结案",
  FALSE_POSITIVE: "误报",
}

export const STATUS_ENGLISH: Record<DossierStatus, string> = {
  PENDING: "Pending",
  DISPATCHED: "Dispatched",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
  FALSE_POSITIVE: "False Positive",
}

export const QUICK_ACTION_LABEL: Record<QuickActionType, string> = {
  VOICE_INTERCOM: "广播语音喊话劝离",
  RECTIFICATION_ORDER: "下发安全隐患整改单",
  SIGN_OFF: "一键确认并结案归档",
}

export const INITIAL_ACTIONS: DispatchAction[] = [
  {
    id: "ACT-0001",
    dossierId: INITIAL_DOSSIER.dossierId,
    operator: "Vigil 规则引擎",
    actionType: "工单自动创建",
    notes: "命中规则「人员聚集推搡预警」，生成 CRITICAL 案卷并进入待处置队列。",
    timestamp: "14:32:10",
  },
]

export const INITIAL_BROADCAST: ChannelBroadcastStatus[] = [
  {
    channelType: "SIREN",
    name: "监控大屏声光警报",
    status: "IDLE",
    target: "指挥中心大屏 / 全屏告警层",
  },
  {
    channelType: "WEBHOOK",
    name: "Webhook 系统联动",
    status: "IDLE",
    target: "https://api.factory-safety.com/v1/emergency-webhook",
  },
  {
    channelType: "IM_BOT",
    name: "企业微信 / 钉钉群机器人",
    status: "IDLE",
    target: "安全生产应急群 @东门安保组",
  },
  {
    channelType: "IOT_HARDWARE",
    name: "现场 IoT 硬件联动",
    status: "IDLE",
    target: "车间闸机 GATE-02 / 声光警号 HORN-02",
  },
]

export function formatClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatClipTime(seconds: number): string {
  const total = Math.max(0, Math.min(CLIP_SECONDS, seconds))
  const mm = Math.floor(total / 60)
  const ss = Math.floor(total % 60)
  const frame = Math.floor((total % 1) * CLIP_FPS)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(mm)}:${pad(ss)}:${pad(frame)}`
}

export function formatOffset(offsetSec: number): string {
  if (offsetSec === 0) return "T"
  return offsetSec > 0 ? `T+${offsetSec}s` : `T${offsetSec}s`
}
