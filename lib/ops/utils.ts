import type { AlertEvent, AlertStatus, OverlayBox } from "./types"

export function timeToSeconds(time: string) {
  const [h = 0, m = 0, s = 0] = time.split(":").map(Number)
  return h * 3600 + m * 60 + s
}

export function secondsToTime(total: number) {
  const t = ((Math.floor(total) % 86400) + 86400) % 86400
  const h = String(Math.floor(t / 3600)).padStart(2, "0")
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0")
  const s = String(t % 60).padStart(2, "0")
  return `${h}:${m}:${s}`
}

export function shanghaiClock(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

export function shanghaiDate(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/\//g, "-")
}

export function groupLabel(minutesAgo: number) {
  if (minutesAgo < 3) return "刚刚"
  if (minutesAgo < 8) return "5分钟前"
  if (minutesAgo < 13) return "10分钟前"
  if (minutesAgo < 30) return "30分钟内"
  return "更早"
}

export function relativeLabel(minutesAgo: number) {
  if (minutesAgo < 1) return "刚刚"
  if (minutesAgo < 60) return `${minutesAgo} 分钟前`
  return `${Math.floor(minutesAgo / 60)} 小时前`
}

export const STATUS_LABEL: Record<AlertStatus, string> = {
  open: "待处置",
  acked: "已确认",
  assigned: "已指派",
  false_positive: "误报",
  archived: "已归档",
}

export function isResolved(status: AlertStatus) {
  return status !== "open"
}

const FRAME_W = 1920
const FRAME_H = 1080

export function toPixelBox(box: OverlayBox): [number, number, number, number] {
  const x1 = Math.round((box.x / 100) * FRAME_W)
  const y1 = Math.round((box.y / 100) * FRAME_H)
  const x2 = Math.round(((box.x + box.w) / 100) * FRAME_W)
  const y2 = Math.round(((box.y + box.h) / 100) * FRAME_H)
  return [x1, y1, x2, y2]
}

export function countOpen(alerts: AlertEvent[], severity: AlertEvent["severity"]) {
  return alerts.filter((a) => a.severity === severity && a.status === "open").length
}

let audioContext: AudioContext | null = null

export function playAlarm() {
  try {
    audioContext ??= new AudioContext()
    const ctx = audioContext
    if (ctx.state === "suspended") void ctx.resume()
    ;[0, 0.22].forEach((delay) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "square"
      osc.frequency.value = delay === 0 ? 880 : 660
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay)
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + delay + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.18)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + delay)
      osc.stop(ctx.currentTime + delay + 0.2)
    })
  } catch {
    // Autoplay policies can block audio before the first user gesture.
  }
}
