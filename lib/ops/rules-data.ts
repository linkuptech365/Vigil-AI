import type {
  ChannelCooldown,
  CorrelatedIncident,
  DeduplicationMetrics,
  EvidenceTrigger,
  InspectionRule,
  RuleActionKey,
  RuleSchedule,
  RuleSeverity,
} from "./rules-types"

export const ALL_CHANNELS = ["CAM-01", "CAM-02", "CAM-03", "CAM-04"]

export const COOLDOWN_OPTIONS = [30, 60, 120] as const

export const SCHEDULE_LABEL: Record<RuleSchedule, string> = {
  "24x7": "全天候 24x7",
  NIGHT_ONLY: "夜间非工作时段 22:00~06:00",
  WORK_HOURS: "工作时段 08:00~18:00",
}

export const SEVERITY_LABEL: Record<RuleSeverity, string> = {
  CRITICAL: "CRITICAL 严重",
  WARNING: "WARNING 警告",
}

export const ACTION_LABEL: Record<RuleActionKey, string> = {
  webhook: "Webhook 回调",
  dispatch: "推送至调度中心",
  siren: "现场声光报警",
}

export const INITIAL_INSPECTION_RULES: InspectionRule[] = [
  {
    id: "RULE-01",
    name: "电子围栏入侵与绊线越界",
    type: "GEOMETRIC",
    logic: "目标检测框底边中点命中多边形禁区或穿越绊线，由一级感知引擎确定性判定，不调用大模型。",
    boundChannels: ["CAM-03", "CAM-01"],
    severity: "CRITICAL",
    cooldownSeconds: 60,
    schedule: "24x7",
    enabled: true,
  },
  {
    id: "RULE-02",
    name: "高危作业区域人员超时滞留",
    type: "THRESHOLD",
    logic: "同一目标 ID 在高危区域内连续停留时长超过 30s 即触发，目标丢失 5s 内重新出现则累计计时。",
    boundChannels: ["CAM-03"],
    severity: "WARNING",
    cooldownSeconds: 120,
    schedule: "24x7",
    enabled: true,
  },
  {
    id: "RULE-03",
    name: "剧烈肢体冲突与推搡打架",
    type: "PROMPT_SEMANTIC",
    prompt: "检测到握拳挥击、摔倒纠缠、撕扯等攻击性肢体对抗动作",
    boundChannels: ["CAM-02", "CAM-04"],
    severity: "CRITICAL",
    cooldownSeconds: 60,
    schedule: "24x7",
    enabled: true,
  },
  {
    id: "RULE-04",
    name: "烟雾与明火早期隐患预警",
    type: "PROMPT_SEMANTIC",
    prompt: "画面中出现非蒸汽的白色或灰黑色烟雾持续扩散，或可见橙红色明火火焰",
    boundChannels: ["CAM-03", "CAM-04"],
    severity: "CRITICAL",
    cooldownSeconds: 30,
    schedule: "24x7",
    enabled: true,
  },
  {
    id: "RULE-05",
    name: "劳保穿戴违规",
    type: "PROMPT_SEMANTIC",
    prompt: "作业区域内人员未穿戴反光背心或未佩戴安全帽",
    boundChannels: ["CAM-02", "CAM-01"],
    severity: "WARNING",
    cooldownSeconds: 60,
    schedule: "WORK_HOURS",
    enabled: false,
  },
]

export const INITIAL_DEDUP_METRICS: DeduplicationMetrics = {
  rawTriggersCount: 184,
  suppressedCount: 164,
  incidentCount: 20,
  correlatedCount: 3,
}

export const DEDUP_WINDOW_SECONDS = 60

/** CAM-02 starts mid-window: triggers at 00:00 / 00:08 / 00:15 / 00:23, now 00:41, so 42s of cooldown remain. */
export const INITIAL_COOLDOWNS: Record<string, ChannelCooldown> = {
  "CAM-01": { incidentId: null, pulses: [], elapsed: 0, windowSeconds: DEDUP_WINDOW_SECONDS },
  "CAM-02": {
    incidentId: "INC-20261020-009",
    pulses: [
      { id: 1, offset: 0, kind: "incident" },
      { id: 2, offset: 8, kind: "suppressed" },
      { id: 3, offset: 15, kind: "suppressed" },
      { id: 4, offset: 23, kind: "suppressed" },
    ],
    elapsed: 41,
    windowSeconds: DEDUP_WINDOW_SECONDS,
  },
  "CAM-03": { incidentId: null, pulses: [], elapsed: 0, windowSeconds: DEDUP_WINDOW_SECONDS },
  "CAM-04": { incidentId: null, pulses: [], elapsed: 0, windowSeconds: DEDUP_WINDOW_SECONDS },
}

export const INITIAL_INCIDENT_SEQ = 9

export const STORM_SCHEDULE_MS = [0, 700, 1500, 2400, 3500, 4800]

export const CORRELATED_INCIDENT: CorrelatedIncident = {
  incidentId: "INC-20261020-008",
  title: "东门通道至1号车间逃窜/冲突事件",
  primaryChannelId: "CAM-02",
  relatedChannelIds: ["CAM-01"],
  startTime: "17:42:08",
  durationSeconds: 38,
  rawTriggersFolded: 9,
  spatialAffinity: 92.4,
  dualKeyframes: [
    { channelId: "CAM-01", timestamp: "17:42:08", thumbnail: "/ops/cam-01-gate.png" },
    { channelId: "CAM-02", timestamp: "17:42:46", thumbnail: "/ops/cam-02-workshop.png" },
  ],
}

export const CORRELATION_WINDOW_SECONDS = 45

export const EVIDENCE_CHAIN: EvidenceTrigger[] = [
  { time: "17:42:08", channelId: "CAM-01", rule: "RULE-03", role: "correlated", note: "目标进入东门通道，被首次标记为可疑对象 (Track #1187)" },
  { time: "17:42:19", channelId: "CAM-01", rule: "RULE-03", role: "folded", note: "同一目标快速向厂区纵深移动，折叠入关联证据链" },
  { time: "17:42:31", channelId: "CAM-01", rule: "RULE-03", role: "folded", note: "目标离开东门视野，轨迹移交相邻机位" },
  { time: "17:42:40", channelId: "CAM-02", rule: "RULE-01", role: "primary", note: "目标越过机加工车间红线，生成主事件并触发声光告警" },
  { time: "17:42:43", channelId: "CAM-02", rule: "RULE-03", role: "folded", note: "出现推搡动作，60s 冷却窗口内合并" },
  { time: "17:42:46", channelId: "CAM-02", rule: "RULE-03", role: "folded", note: "与另一名人员发生肢体冲突，证据追加" },
  { time: "17:42:51", channelId: "CAM-02", rule: "RULE-03", role: "folded", note: "冲突持续，已抑制重复通知" },
  { time: "17:42:58", channelId: "CAM-02", rule: "RULE-01", role: "folded", note: "再次触发绊线，已抑制重复通知" },
  { time: "17:43:06", channelId: "CAM-02", rule: "RULE-03", role: "folded", note: "目标逃离画面，证据链闭合" },
]

export const DEFAULT_CUSTOM_PROMPT =
  "当画面中出现人员摔倒且保持仰卧/侧卧姿态超过 15 秒未自行站起时，触发高危人员伤亡求助预警"
