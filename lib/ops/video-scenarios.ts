import type { BoxTone, ChannelId, OverlayBox } from "./types"

export const CLIP_DURATION = 30

export type PhaseLevel = "normal" | "warn" | "critical"

export interface ScenarioPhase {
  /** Inclusive start, in seconds of clip playback time. */
  from: number
  /** Exclusive end. */
  to: number
  level: PhaseLevel
  status: string
  banner?: string
  /** Words used to match an alert or search hit to this phase. */
  keywords?: string[]
  boxes: OverlayBox[] | ((t: number) => OverlayBox[])
}

const CHANNELS: readonly ChannelId[] = ["CAM-01", "CAM-02", "CAM-03", "CAM-04"]

export function isChannelId(value: string): value is ChannelId {
  return (CHANNELS as readonly string[]).includes(value)
}

export function formatClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function operator(t: number, tone: BoxTone, label: string, pulse = false): OverlayBox {
  return { x: 12 + Math.min(t, 18) * (62 / 18), y: 48, w: 8.5, h: 34, tone, label, pulse }
}

const CAM01_OK: OverlayBox[] = [
  { x: 66, y: 42, w: 8, h: 43, tone: "ok", label: "PERSON · PPE OK [97%]" },
  { x: 75, y: 41, w: 10, h: 44, tone: "ok", label: "PERSON · PPE OK [96%]" },
]
const CAM01_VEHICLE_OK: OverlayBox = { x: 35, y: 18, w: 17, h: 34, tone: "ok", label: "VEHICLE [95%]" }

const CAM03_ZONE: OverlayBox = { x: 3, y: 54, w: 56, h: 36, tone: "zone", label: "ELECTRONIC FENCE · ZONE-A" }
const CAM04_FORKLIFT_OK: OverlayBox = { x: 33.5, y: 42, w: 19.5, h: 38, tone: "ok", label: "FORKLIFT 6km/h" }

export const SCENARIOS: Record<ChannelId, ScenarioPhase[]> = {
  "CAM-01": [
    {
      from: 0,
      to: 12,
      level: "normal",
      status: "正常监控中",
      boxes: [...CAM01_OK, CAM01_VEHICLE_OK],
    },
    {
      from: 12,
      to: 23,
      level: "warn",
      status: "预警中 · 车辆违停",
      banner: "检测到车辆在黄线区停留超时！",
      keywords: ["违停", "车辆", "货车", "停车", "东门"],
      boxes: [
        ...CAM01_OK,
        { x: 35, y: 18, w: 17, h: 34, tone: "warn", pulse: true, label: "ILLEGAL PARKING [87%]" },
      ],
    },
    {
      from: 23,
      to: 31,
      level: "normal",
      status: "已恢复 · 车辆驶离",
      boxes: CAM01_OK,
    },
  ],
  "CAM-02": [
    {
      from: 0,
      to: 7,
      level: "normal",
      status: "正常监控中 · 洁净区作业",
      boxes: (t) => [operator(t, "ok", "[ID: #104 | Operator | Normal]")],
    },
    {
      from: 7,
      to: 19,
      level: "critical",
      status: "预警中 · 防静电鞋违规",
      banner: "检测到未穿防静电鞋跨过阻隔区！",
      keywords: ["防静电", "ESD", "阻隔", "洁净", "隔离线", "跨越", "跨过", "反光", "红色", "GMP"],
      boxes: (t) => [operator(t, "critical", "[VIOLATION: NO_ESD_SHOES | 94%]", true)],
    },
    {
      from: 19,
      to: 25,
      level: "warn",
      status: "复核中 · 着装整改",
      banner: "同区域人员未佩戴安全帽，请现场核查",
      keywords: ["安全帽", "头盔", "未戴", "没戴", "PPE"],
      boxes: (t) => [
        operator(t, "warn", "[ID: #104 | Operator | Warning]"),
        { x: 19, y: 50, w: 7.5, h: 30, tone: "warn", pulse: true, label: "NO_HELMET [92%]" },
      ],
    },
    {
      from: 25,
      to: 31,
      level: "normal",
      status: "已恢复 · 着装合规",
      boxes: (t) => [
        operator(t, "ok", "[ID: #104 | Operator | Resolved]"),
        { x: 19, y: 50, w: 7.5, h: 30, tone: "ok", label: "HELMET OK [98%]" },
      ],
    },
  ],
  "CAM-03": [
    {
      from: 0,
      to: 10,
      level: "normal",
      status: "电子围栏布控中",
      boxes: [CAM03_ZONE, { x: 19.5, y: 56.5, w: 4.5, h: 12, tone: "ok", label: "PERSON · IN-BOUND [95%]" }],
    },
    {
      from: 10,
      to: 20,
      level: "critical",
      status: "预警中 · 越界入侵",
      banner: "检测到人员越过电子围栏进入禁区！",
      keywords: ["禁区", "越界", "围栏", "栅栏", "攀越", "周界", "滞留", "入侵"],
      boxes: [CAM03_ZONE, { x: 19, y: 55.5, w: 5.5, h: 14, tone: "critical", pulse: true, label: "INTRUSION [94%]" }],
    },
    {
      from: 20,
      to: 28,
      level: "critical",
      status: "预警中 · 疑似烟雾",
      banner: "管廊区域检测到持续白色烟雾！",
      keywords: ["烟", "火", "烟雾", "明火", "储罐", "管廊"],
      boxes: [CAM03_ZONE, { x: 38.5, y: 30, w: 11, h: 11, tone: "critical", pulse: true, label: "SMOKE [94%]" }],
    },
    {
      from: 28,
      to: 31,
      level: "normal",
      status: "已恢复 · 区域正常",
      boxes: [CAM03_ZONE],
    },
  ],
  "CAM-04": [
    {
      from: 0,
      to: 9,
      level: "normal",
      status: "叉车通道正常",
      boxes: [CAM04_FORKLIFT_OK],
    },
    {
      from: 9,
      to: 19,
      level: "critical",
      status: "预警中 · 人员聚集推搡",
      banner: "检测到多人聚集并出现肢体推搡！",
      keywords: ["打架", "冲突", "推搡", "聚集", "斗殴", "争执"],
      boxes: [
        CAM04_FORKLIFT_OK,
        { x: 68, y: 49, w: 19, h: 39, tone: "critical", pulse: true, label: "CONFLICT ×4 [88%]" },
      ],
    },
    {
      from: 19,
      to: 28,
      level: "warn",
      status: "预警中 · 叉车逆行",
      banner: "检测到叉车在单向通道内逆向行驶",
      keywords: ["叉车", "逆行", "超速", "逆向"],
      boxes: [{ x: 33.5, y: 42, w: 19.5, h: 38, tone: "warn", pulse: true, label: "FORKLIFT WRONG-WAY [91%]" }],
    },
    {
      from: 28,
      to: 31,
      level: "normal",
      status: "已恢复 · 通道正常",
      boxes: [CAM04_FORKLIFT_OK],
    },
  ],
}

export function resolveScenario(channelId: ChannelId, t: number): ScenarioPhase {
  const phases = SCENARIOS[channelId]
  return phases.find((phase) => t >= phase.from && t < phase.to) ?? phases[phases.length - 1]
}

export function phaseBoxes(phase: ScenarioPhase, t: number): OverlayBox[] {
  return typeof phase.boxes === "function" ? phase.boxes(t) : phase.boxes
}

/**
 * Picks the playback second that shows an incident best: the alarm phase whose
 * keywords match the text most often, 1.5s in so the boxes are already drawn.
 */
export function defaultIncidentSec(channelId: ChannelId, text = ""): number {
  const alarms = SCENARIOS[channelId].filter((phase) => phase.level !== "normal")
  if (alarms.length === 0) return 0
  const scored = alarms.map((phase) => ({
    phase,
    hits: (phase.keywords ?? []).filter((keyword) => text.includes(keyword)).length,
  }))
  const best = scored.reduce((acc, entry) => (entry.hits > acc.hits ? entry : acc), scored[0])
  return best.phase.from + 1.5
}

export function alertClipSec(alert: { cameraId: string; type: string; summary: string; rule: string }): number {
  if (!isChannelId(alert.cameraId)) return 0
  return defaultIncidentSec(alert.cameraId, `${alert.type} ${alert.summary} ${alert.rule}`)
}

/** Percent coordinates of the first non-compliant box at time t, used as the ripple origin. */
export function rippleOrigin(channelId: ChannelId, t: number): { x: number; y: number } {
  const boxes = phaseBoxes(resolveScenario(channelId, t), t).filter((box) => box.tone !== "zone")
  const target = boxes.find((box) => box.tone === "critical" || box.tone === "warn") ?? boxes[0]
  return target ? { x: target.x + target.w / 2, y: target.y + target.h / 2 } : { x: 50, y: 50 }
}
