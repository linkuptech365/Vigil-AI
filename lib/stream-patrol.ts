import { loadStreams } from "@/lib/storage/streams-store"
import { visionHandlesPatrol } from "@/lib/vision-engine"

const PATROL_TICK_MS = 15_000
const PATROL_BASE_INTERVAL_MS = 600_000
const PATROL_MAX_INTERVAL_MS = 3_600_000

interface PatrolState {
  timer: ReturnType<typeof setInterval> | null
  running: boolean
  lastWarn: Map<string, number>
  warnStreak: Map<string, number>
}

const globalState = globalThis as unknown as { __vigilPatrol?: PatrolState }

function state(): PatrolState {
  if (!globalState.__vigilPatrol) {
    globalState.__vigilPatrol = { timer: null, running: false, lastWarn: new Map(), warnStreak: new Map() }
  }
  return globalState.__vigilPatrol
}

/** 全局硬开关：未显式设置 ENABLE_STREAM_PATROL=true 时，巡检漏斗不启动，也不会触发任何大模型调用。 */
export function isStreamPatrolEnabled() {
  const value = process.env.ENABLE_STREAM_PATROL?.trim().toLowerCase()
  return value === "true" || value === "1"
}

/** 阶梯退避：10 分钟 -> 20 分钟 -> 30 分钟 …… 最长 1 小时。 */
function intervalFor(streak: number) {
  return Math.min(PATROL_BASE_INTERVAL_MS * (streak + 1), PATROL_MAX_INTERVAL_MS)
}

/**
 * 巡检不再回落到定时整段研判：视觉漏斗（Worker）未接管的通道只输出告警日志并暂停自动巡检，
 * 不向大模型发起任何请求。重复告警按阶梯退避，通道恢复接管后计数清零。
 */
async function patrolOnce() {
  const patrol = state()
  if (patrol.running || !isStreamPatrolEnabled()) return
  patrol.running = true
  try {
    const now = Date.now()
    const handledByVision = await visionHandlesPatrol().catch(() => new Set<string>())
    for (const stream of loadStreams()) {
      if (!stream.autoPatrol) continue
      if (handledByVision.has(stream.id)) {
        patrol.lastWarn.delete(stream.id)
        patrol.warnStreak.delete(stream.id)
        continue
      }
      const streak = patrol.warnStreak.get(stream.id) ?? 0
      const lastWarn = patrol.lastWarn.get(stream.id) ?? 0
      if (now - lastWarn < intervalFor(streak)) continue
      patrol.lastWarn.set(stream.id, now)
      patrol.warnStreak.set(stream.id, streak + 1)
      console.warn(
        `[stream-patrol] [Vision Worker Offline/Not Ready] 通道 ${stream.name}（${stream.id}）未被视觉漏斗接管，已暂停自动巡检；不会回落到大模型整段研判。`,
      )
    }
  } finally {
    patrol.running = false
  }
}

/** 幂等启动：热更新或重复调用不会产生多个定时器；全局开关关闭时直接返回，不创建任何定时器。 */
export function startStreamPatrol() {
  if (!isStreamPatrolEnabled()) {
    console.info("[stream-patrol] ENABLE_STREAM_PATROL 未启用，服务端自动巡检已关闭（不会产生后台 Token 消耗）")
    return
  }
  const patrol = state()
  if (patrol.timer) return
  patrol.timer = setInterval(() => void patrolOnce(), PATROL_TICK_MS)
  patrol.timer.unref?.()
}
