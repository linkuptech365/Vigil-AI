import { analyzeStream } from "@/lib/ops/server/stream-analysis"
import { loadStreams } from "@/lib/storage/streams-store"
import { tier0AllowsPatrol, visionHandlesPatrol } from "@/lib/vision-engine"

const PATROL_TICK_MS = 15_000
const PATROL_INTERVAL_MS = 60_000
const PATROL_TIMEOUT_MS = 90_000

interface PatrolState {
  timer: ReturnType<typeof setInterval> | null
  running: boolean
  lastRun: Map<string, number>
}

const globalState = globalThis as unknown as { __vigilPatrol?: PatrolState }

function state(): PatrolState {
  if (!globalState.__vigilPatrol) globalState.__vigilPatrol = { timer: null, running: false, lastRun: new Map() }
  return globalState.__vigilPatrol
}

async function patrolOnce() {
  const patrol = state()
  if (patrol.running) return
  patrol.running = true
  try {
    const now = Date.now()
    // 视觉漏斗就绪时由它接管自动巡检（仅在 Tier-0/1 判定疑似时才触发大模型）；未就绪才回落到定时整段研判
    const handledByVision = await visionHandlesPatrol().catch(() => new Set<string>())
    // Python 漏斗不可用时由 Node 端帧差预筛兜底：自上次研判以来画面没变化的通道不送审大模型
    const due = loadStreams().filter((stream) => {
      if (!stream.autoPatrol || handledByVision.has(stream.id)) return false
      const lastRun = patrol.lastRun.get(stream.id) ?? 0
      return now - lastRun >= PATROL_INTERVAL_MS && tier0AllowsPatrol(stream.id, lastRun)
    })
    for (const stream of due) {
      patrol.lastRun.set(stream.id, Date.now())
      try {
        await analyzeStream({
          streamId: stream.id,
          source: "stream",
          requestHost: null,
          signal: AbortSignal.timeout(PATROL_TIMEOUT_MS),
        })
      } catch (error) {
        console.error(`[stream-patrol] 通道 ${stream.id} 巡检失败：`, error instanceof Error ? error.message : error)
      }
    }
  } finally {
    patrol.running = false
  }
}

/** 幂等启动：热更新或重复调用不会产生多个定时器。逐路串行巡检，避免同时占满模型网关。 */
export function startStreamPatrol() {
  const patrol = state()
  if (patrol.timer) return
  patrol.timer = setInterval(() => void patrolOnce(), PATROL_TICK_MS)
  patrol.timer.unref?.()
}
