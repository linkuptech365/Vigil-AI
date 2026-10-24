import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { validPythons, visionPaths, visionRuntimeEnv } from "../scripts/lib/python-runtime.mjs"
import { loadVisionConfig } from "@/lib/storage/vision-store"
import { loadStreams } from "@/lib/storage/streams-store"
import {
  motionFallbackActive,
  motionFallbackSnapshot,
  motionSince,
  resetMotionFallbackStats,
  setMotionFallbackActive,
} from "@/lib/vision-motion-fallback"
import {
  EMPTY_VISION_STATS,
  type VisionConfig,
  type VisionEvent,
  type VisionInfo,
  type VisionIssue,
  type VisionStats,
  type VisionStatus,
  type VisionStreamHealth,
} from "@/lib/vigil/vision"

const WORKER_HOST = "127.0.0.1"
const WORKER_PORT = Number(process.env.VIGIL_VISION_PORT) || 1985
const WORKER_BASE = `http://${WORKER_HOST}:${WORKER_PORT}`
const GO2RTC_URL = "http://127.0.0.1:1984"

const HEALTH_INTERVAL_MS = 5_000
const STARTUP_GRACE_MS = 20_000
const MAX_BACKOFF_MS = 30_000
const STABLE_UPTIME_MS = 60_000
const INSTALL_TIMEOUT_MS = 40 * 60_000

interface WorkerHealth {
  status: "ready" | "degraded" | "loading"
  mode: string
  reason: string
  device: string
  modelLoaded: boolean
  weightsPresent: boolean
  trackerKind: string
  classes: { promptEn: string; labelZh: string; role: string }[]
  stats: VisionStats
  streams: Record<string, VisionStreamHealth>
  recentEvents: VisionEvent[]
  versions: Record<string, string>
  lastReloadMs: number
}

interface VisionState {
  child: ChildProcess | null
  healthy: boolean
  health: WorkerHealth | null
  startedAt: number
  restarts: number
  failures: number
  restartTimer: NodeJS.Timeout | null
  healthTimer: NodeJS.Timeout | null
  stopping: boolean
  lastError: string
  stderrTail: string[]
  hooked: boolean
  lastPushHash: string
  installing: boolean
  installOutput: string
  depsCache: { at: number; ok: boolean; python: PythonPick | null } | null
}

interface PythonPick {
  command: string
  args: string[]
  version: string
  source: string
}

const globalStore = globalThis as typeof globalThis & { __vigilVision?: VisionState }

function state(): VisionState {
  if (!globalStore.__vigilVision) {
    globalStore.__vigilVision = {
      child: null,
      healthy: false,
      health: null,
      startedAt: 0,
      restarts: 0,
      failures: 0,
      restartTimer: null,
      healthTimer: null,
      stopping: false,
      lastError: "",
      stderrTail: [],
      hooked: false,
      lastPushHash: "",
      installing: false,
      installOutput: "",
      depsCache: null,
    }
  }
  return globalStore.__vigilVision
}

/* --------------------------------- 路径 --------------------------------- */

const workerDir = () => path.join(process.cwd(), "services", "vision-worker")
const workerScript = () => path.join(workerDir(), "main.py")
export const modelsDir = () => visionPaths(process.cwd()).modelsDir

const disabled = () => process.env.VIGIL_DISABLE_VISION_ENGINE === "1"

const DEPS_PROBE = "import fastapi, uvicorn, cv2, numpy, httpx, pydantic"

/**
 * 选择解释器：按 项目内置环境 ➔ python3 ➔ python ➔ py -3 ➔ 常见系统路径 的顺序，
 * 取第一个"版本 >= 3.9 且已装好核心依赖"的；都没装好依赖时返回第一个有效解释器（ok=false，提示去安装）。
 * 候选必须真正执行并通过版本校验，因此 Windows 应用商店的 python3.exe 空壳不会被误认。
 */
function pickPython(): { python: PythonPick | null; ok: boolean } {
  const s = state()
  const ttl = s.depsCache?.ok ? 60_000 : 30_000
  if (s.depsCache && Date.now() - s.depsCache.at < ttl) return { python: s.depsCache.python, ok: s.depsCache.ok }

  let result: { python: PythonPick | null; ok: boolean } = { python: null, ok: false }
  for (const candidate of validPythons(process.cwd())) {
    const probe = spawnSync(candidate.command, [...candidate.args, "-c", DEPS_PROBE], { windowsHide: true, timeout: 15_000 })
    if (probe.status === 0) {
      result = { python: candidate, ok: true }
      break
    }
    if (!result.python) result = { python: candidate, ok: false }
  }
  s.depsCache = { at: Date.now(), ...result }
  return result
}

/** 视觉环境未就绪时由 Node 端接管 Tier-0 帧差预筛；就绪后自动退出，交给 Python 漏斗 */
function syncFallback() {
  const s = state()
  setMotionFallbackActive(!disabled() && !s.healthy && loadVisionConfig().enabled)
}

/** 定时巡检用：自 sinceMs 起该通道是否出现画面变化（预筛不在运行时恒为 true） */
export function tier0AllowsPatrol(streamId: string, sinceMs: number) {
  return motionSince(streamId, sinceMs)
}

/* --------------------------------- HTTP --------------------------------- */

export async function visionFetch(pathname: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs, ...rest } = init
  return fetch(`${WORKER_BASE}${pathname}`, {
    ...rest,
    cache: "no-store",
    signal: rest.signal ?? AbortSignal.timeout(timeoutMs ?? 8_000),
  })
}

async function probeHealth(): Promise<WorkerHealth | null> {
  try {
    const response = await visionFetch("/health", { timeoutMs: 2_500 })
    if (!response.ok) return null
    return (await response.json()) as WorkerHealth
  } catch {
    return null
  }
}

/* ------------------------------- 进程生命周期 ------------------------------- */

function killChild() {
  const { child } = state()
  if (child && !child.killed) {
    try {
      child.kill()
    } catch {
      // 已退出
    }
  }
}

function hookProcessExit() {
  const s = state()
  if (s.hooked) return
  s.hooked = true
  process.once("exit", () => {
    state().stopping = true
    killChild()
  })
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      state().stopping = true
      killChild()
      if (process.listenerCount(signal) === 0) process.exit(0)
    })
  }
}

function scheduleRestart() {
  const s = state()
  if (s.stopping || s.restartTimer || s.installing) return
  const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.min(s.failures, 6))
  s.failures += 1
  s.restartTimer = setTimeout(() => {
    s.restartTimer = null
    s.restarts += 1
    void launch()
  }, delay)
  s.restartTimer.unref?.()
}

async function launch() {
  const s = state()
  if (s.child || s.stopping || s.installing || disabled()) return

  const existing = await probeHealth()
  if (existing) {
    s.healthy = true
    s.health = existing
    await pushConfig(true)
    return
  }

  if (!fs.existsSync(workerScript())) {
    s.lastError = "找不到 services/vision-worker/main.py，请确认部署包包含 services 目录"
    return
  }
  const { python, ok } = pickPython()
  if (!python || !ok) return

  s.stderrTail = []
  s.startedAt = Date.now()
  let child: ChildProcess
  try {
    child = spawn(python.command, [...python.args, workerScript()], {
      cwd: workerDir(),
      env: {
        ...process.env,
        ...visionRuntimeEnv(process.cwd()),
        VIGIL_VISION_PORT: String(WORKER_PORT),
        VIGIL_MODELS_DIR: modelsDir(),
        PYTHONUNBUFFERED: "1",
        PYTHONIOENCODING: "utf-8",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
  } catch (error) {
    s.lastError = `vision-worker 启动失败：${error instanceof Error ? error.message : "未知错误"}`
    scheduleRestart()
    return
  }
  s.child = child

  const remember = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue
      s.stderrTail.push(line.trim().slice(0, 300))
      if (s.stderrTail.length > 8) s.stderrTail.shift()
    }
  }
  child.stdout?.on("data", remember)
  child.stderr?.on("data", remember)

  child.once("error", (error: NodeJS.ErrnoException) => {
    s.child = null
    s.healthy = false
    s.lastError = error.code === "ENOENT" ? `找不到 Python 解释器：${python.command}` : `vision-worker 启动失败：${error.message}`
    scheduleRestart()
  })
  child.once("exit", (code, signal) => {
    s.child = null
    s.healthy = false
    s.lastPushHash = ""
    if (s.stopping) return
    if (Date.now() - s.startedAt > STABLE_UPTIME_MS) s.failures = 0
    s.lastError = `vision-worker 进程退出（${signal ?? `code ${code}`}）${s.stderrTail.length ? `：${s.stderrTail[s.stderrTail.length - 1]}` : ""}`
    scheduleRestart()
  })
}

async function healthTick() {
  const s = state()
  if (s.stopping || s.installing) return
  const health = await probeHealth()
  const wasHealthy = s.healthy
  s.healthy = health !== null
  syncFallback()
  if (health) {
    s.health = health
    if (Date.now() - s.startedAt > STABLE_UPTIME_MS) s.failures = 0
    if (!wasHealthy) s.lastPushHash = ""
    await pushConfig()
    return
  }
  if (!s.child && !s.restartTimer) await launch()
}

/** 幂等：启动健康检查并按需拉起 vision-worker。 */
export async function ensureVisionEngine(options: { waitMs?: number } = {}) {
  if (disabled()) return
  const s = state()
  s.stopping = false
  hookProcessExit()
  if (!s.healthTimer) {
    s.healthTimer = setInterval(() => void healthTick(), HEALTH_INTERVAL_MS)
    s.healthTimer.unref?.()
  }
  if (!s.child && !s.healthy) await launch()
  syncFallback()
  const deadline = Date.now() + (options.waitMs ?? 0)
  while (!s.healthy && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const health = await probeHealth()
    if (health) {
      s.healthy = true
      s.health = health
      syncFallback()
    }
  }
}

export async function restartVisionEngine() {
  const s = state()
  if (s.restartTimer) clearTimeout(s.restartTimer)
  s.restartTimer = null
  s.failures = 0
  s.stopping = true
  killChild()
  await new Promise((resolve) => setTimeout(resolve, 600))
  s.child = null
  s.healthy = false
  s.health = null
  s.lastPushHash = ""
  s.depsCache = null
  s.stopping = false
  await ensureVisionEngine({ waitMs: 8_000 })
}

/** 后台执行 scripts/setup-vision.mjs；立即返回，进度通过引擎状态里的 installOutput 展示。 */
export function installVisionEnv(options: { light?: boolean; cpu?: boolean; gpu?: boolean } = {}): { started: boolean; message: string } {
  const s = state()
  if (s.installing) return { started: false, message: "安装已在进行中" }
  const script = path.join(process.cwd(), "scripts", "setup-vision.mjs")
  if (!fs.existsSync(script)) return { started: false, message: "找不到 scripts/setup-vision.mjs，请确认部署包包含 scripts 目录" }

  s.installing = true
  s.installOutput = ""
  s.stopping = true
  killChild()
  const args = [script]
  if (options.light) args.push("--light")
  else if (options.cpu) args.push("--cpu")
  else if (options.gpu) args.push("--gpu")

  const child = spawn(process.execPath, args, { cwd: process.cwd(), env: { ...process.env, ...visionRuntimeEnv(process.cwd()), VIGIL_MODELS_DIR: modelsDir() }, windowsHide: true })
  const append = (chunk: Buffer) => {
    s.installOutput = `${s.installOutput}${chunk.toString("utf8")}`.slice(-3000)
  }
  child.stdout.on("data", append)
  child.stderr.on("data", append)
  const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS)
  const finish = (message: string) => {
    clearTimeout(timer)
    s.installing = false
    s.stopping = false
    s.child = null
    s.healthy = false
    s.depsCache = null
    s.failures = 0
    if (message) s.installOutput += `\n${message}`
    void ensureVisionEngine({ waitMs: 8_000 })
  }
  child.once("error", (error) => finish(`安装进程启动失败：${error.message}`))
  child.once("exit", (code) => finish(code === 0 ? "安装完成，正在启动视觉服务…" : `安装失败（退出码 ${code}），请查看上方日志`))
  return { started: true, message: "已开始安装视觉环境，首次需要下载 PyTorch 与模型权重，可能需要数分钟到数十分钟" }
}

/* --------------------------------- 配置推送 --------------------------------- */

export function triggerUrl() {
  const base = process.env.VIGIL_INTERNAL_URL?.trim() || `http://127.0.0.1:${process.env.PORT ?? "3000"}`
  return `${base.replace(/\/$/, "")}/api/v1/incident/trigger`
}

/** 自动巡检通道里应交给视觉漏斗处理的通道 id */
export function monitoredStreamIds() {
  return loadStreams()
    .filter((stream) => stream.autoPatrol)
    .map((stream) => stream.id)
}

function buildPayload(config: VisionConfig) {
  return {
    enabled: config.enabled,
    sampleFps: config.sampleFps,
    motionThresholdPct: config.motionThresholdPct,
    confidenceLow: config.confidenceLow,
    confidenceHigh: config.confidenceHigh,
    minConsecutiveFrames: config.minConsecutiveFrames,
    cooldownSeconds: config.cooldownSeconds,
    staticRecheckSec: config.staticRecheckSeconds,
    vocabulary: config.vocabulary,
    streamIds: monitoredStreamIds(),
    go2rtcUrl: GO2RTC_URL,
    triggerUrl: triggerUrl(),
  }
}

export interface PushResult {
  ok: boolean
  reloadMs: number
  message: string
}

/** 把落盘配置热更新到 vision-worker；内容未变化时跳过，force 为真时强制推送。 */
export async function pushConfig(force = false, config: VisionConfig = loadVisionConfig()): Promise<PushResult | null> {
  const s = state()
  if (!s.healthy) return null
  const payload = buildPayload(config)
  const hash = crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex")
  if (!force && hash === s.lastPushHash) return null
  try {
    const response = await visionFetch("/config/reload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 60_000,
    })
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; reloadMs?: number; message?: string }
    if (!response.ok) return { ok: false, reloadMs: 0, message: `vision-worker 拒绝了配置（HTTP ${response.status}）` }
    s.lastPushHash = hash
    return { ok: body.ok !== false, reloadMs: body.reloadMs ?? 0, message: body.message ?? "" }
  } catch (error) {
    return { ok: false, reloadMs: 0, message: `推送配置失败：${error instanceof Error ? error.message : "未知错误"}` }
  }
}

/* ----------------------------------- 状态 ----------------------------------- */

/** 巡检循环用：视觉漏斗是否已接管自动巡检（模型就绪才接管，否则回落到定时整段研判）。 */
export async function visionHandlesPatrol(): Promise<Set<string>> {
  if (disabled()) return new Set()
  await ensureVisionEngine()
  const s = state()
  if (!s.healthy || !s.health) return new Set()
  await pushConfig()
  const config = loadVisionConfig()
  if (!config.enabled || s.health.status !== "ready" || s.health.classes.length === 0) return new Set()
  return new Set(monitoredStreamIds())
}

function describe(): { status: VisionStatus; issue?: VisionIssue; message: string } {
  const s = state()
  if (disabled()) return { status: "disabled", issue: "disabled", message: "已通过 VIGIL_DISABLE_VISION_ENGINE=1 关闭视觉初筛服务" }
  if (s.installing) return { status: "installing", message: "正在安装视觉运行环境…" }
  if (s.healthy && s.health) {
    return { status: s.health.status, message: s.health.reason || (s.health.status === "ready" ? "YOLO-World + ByteTrack 运行正常" : "视觉服务模型加载中") }
  }
  const { python, ok } = pickPython()
  if (!python) {
    return {
      status: "offline",
      issue: "no-python",
      message: "未检测到可用的 Python 3.9+（已跳过 Windows 应用商店占位程序）。点击「一键自动部署视觉环境」将自动下载内置 Python，无需手动安装",
    }
  }
  if (!ok) return { status: "offline", issue: "not-installed", message: `已找到 Python ${python.version}，但视觉依赖尚未安装。点击「一键自动部署视觉环境」即可` }
  if (s.child && Date.now() - s.startedAt < STARTUP_GRACE_MS) return { status: "starting", message: "视觉服务正在启动…" }
  if (s.restartTimer || (!s.child && s.lastError)) {
    return { status: "offline", issue: "crashed", message: `${s.lastError || "视觉服务进程已退出"}，正在自动重启（第 ${s.restarts + 1} 次）` }
  }
  if (!s.child) return { status: "starting", message: "视觉服务正在启动…" }
  return { status: "offline", issue: "unreachable", message: `视觉服务进程已启动但 ${WORKER_HOST}:${WORKER_PORT} 无响应${s.stderrTail.length ? `：${s.stderrTail[s.stderrTail.length - 1]}` : ""}` }
}

export async function getVisionInfo(): Promise<VisionInfo> {
  await ensureVisionEngine()
  const s = state()
  if (!s.healthy && s.child) {
    const health = await probeHealth()
    if (health) {
      s.healthy = true
      s.health = health
    }
  }
  syncFallback()
  const info = describe()
  const health = s.healthy ? s.health : null
  const fallback = !health && motionFallbackActive() ? motionFallbackSnapshot() : null
  if (fallback && info.status === "offline") {
    info.status = "degraded"
    info.message = `${info.message}。Node 端已接管 Tier-0 帧差预筛：静止画面不再送审大模型，环境部署完成后自动升级为 YOLO-World + ByteTrack`
  }
  return {
    status: info.status,
    issue: info.issue,
    message: info.message,
    mode: health?.mode ?? (fallback ? "node-motion" : "offline"),
    device: health?.device ?? (fallback ? "node" : ""),
    enabled: loadVisionConfig().enabled,
    modelLoaded: health?.modelLoaded ?? false,
    weightsPresent: health?.weightsPresent ?? fs.existsSync(path.join(modelsDir(), "yolov8s-worldv2.pt")),
    trackerKind: health?.trackerKind ?? "",
    classes: health?.classes ?? [],
    stats: health?.stats ?? fallback?.stats ?? { ...EMPTY_VISION_STATS },
    streams: health?.streams ?? fallback?.streams ?? {},
    recentEvents: health?.recentEvents ?? [],
    versions: health?.versions ?? {},
    lastReloadMs: health?.lastReloadMs ?? 0,
    restarts: s.restarts,
    installOutput: s.installing || s.installOutput ? s.installOutput : undefined,
  }
}

export function visionHealthy() {
  return state().healthy
}
