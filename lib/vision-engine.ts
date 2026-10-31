import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { validPythons, visionPaths, visionRuntimeEnv } from "../scripts/lib/python-runtime.mjs"
import { channelVocabularies } from "@/lib/ops/server/channel-perception"
import { workerChannelRules, type WorkerChannelRules } from "@/lib/ops/server/rule-vocabulary"
import type { RulePipelineConfig } from "@/lib/ops/types"
import { loadRules } from "@/lib/storage/rules-store"
import { loadZones } from "@/lib/storage/roi-store"
import { loadVisionConfig } from "@/lib/storage/vision-store"
import { loadStreams } from "@/lib/storage/streams-store"
import { loadAllLearning } from "@/lib/storage/tier1-learning-store"
import { toWorkerLearning, type WorkerLearning } from "@/lib/vigil/tier1-learning"
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
  type VisionHitEntry,
  type VisionHitsResponse,
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
/** 配置热更新下发后的宽限期：期间探活失败不计入连续心跳失败，也不触发降级 */
const RELOAD_GRACE_MS = 30_000
/** 宽限期之外，连续丢失这么多次心跳才判定 Worker 掉线（5s 一次 ≈ 15s） */
const MISS_TOLERANCE = 3
/** 进程存活却连续这么多次心跳无响应（≈ 90s）视为假死，强制重启 */
const HUNG_BEATS = 18

interface WorkerHealth {
  status: "ready" | "degraded" | "loading"
  /** Worker 后台正在应用词表（/health 原始 status 为 busy_updating 时置位） */
  updating?: boolean
  effectiveFps?: number
  cpuThrottled?: boolean
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
  hitLog?: VisionHitEntry[]
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
  /** 热更新宽限期截止时间戳（ms） */
  graceUntil: number
  /** 宽限期之外连续丢失的心跳数 */
  missedBeats: number
  /** 进入降级（node-motion）的时间戳，0 表示未降级 */
  degradedSince: number
  ticking: boolean
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
      graceUntil: 0,
      missedBeats: 0,
      degradedSince: 0,
      ticking: false,
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
    const body = (await response.json()) as Omit<WorkerHealth, "status"> & {
      status: WorkerHealth["status"] | "busy_updating"
      modelState?: WorkerHealth["status"]
    }
    // busy_updating 只代表后台正在应用词表，进程是活的：按底层模型状态对待，并标记 updating
    if (body.status === "busy_updating") return { ...body, status: body.modelState ?? "ready", updating: true }
    return { ...body, status: body.status, updating: false }
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

const inReloadGrace = () => Date.now() < state().graceUntil

/**
 * 5 秒一次的静默心跳，同时承担"降级后自动恢复探测"：
 * - 热更新宽限期内探活失败不计数、不降级；
 * - 宽限期外连续 MISS_TOLERANCE 次失败才降级到 node-motion 帧差；
 * - 降级期间继续探测，Worker 一响应就无缝升级回 YOLO-World + ByteTrack，无需人工重启；
 * - 进程存活却长期无响应（假死）则强制重启。
 */
async function healthTick() {
  const s = state()
  if (s.stopping || s.installing || s.ticking) return
  s.ticking = true
  try {
    const health = await probeHealth()
    if (health) {
      const wasHealthy = s.healthy
      const recovered = !wasHealthy && s.degradedSince > 0
      s.healthy = true
      s.health = health
      s.missedBeats = 0
      if (recovered) {
        console.log(`[vision-engine] 视觉 Worker 已恢复响应（降级 ${Math.round((Date.now() - s.degradedSince) / 1000)}s），自动升级回 YOLO-World + ByteTrack`)
        s.degradedSince = 0
      }
      syncFallback()
      if (Date.now() - s.startedAt > STABLE_UPTIME_MS) s.failures = 0
      if (!wasHealthy) s.lastPushHash = ""
      await pushConfig()
      return
    }

    if (inReloadGrace()) return

    s.missedBeats += 1
    if (s.healthy && s.missedBeats < MISS_TOLERANCE) return
    s.healthy = false
    if (!s.degradedSince) s.degradedSince = Date.now()
    syncFallback()

    if (s.child && s.missedBeats >= HUNG_BEATS && Date.now() - s.startedAt > STARTUP_GRACE_MS) {
      s.lastError = `vision-worker 进程假死（连续 ${s.missedBeats} 次心跳无响应），已强制重启`
      s.missedBeats = 0
      killChild()
      return
    }
    if (!s.child && !s.restartTimer) await launch()
  } finally {
    s.ticking = false
  }
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
  if (process.env.VIGIL_PREBAKED_VISION === "1") {
    return {
      started: false,
      message:
        "当前镜像已内置视觉环境（Python 3.11 + 全部依赖 + YOLO-World 权重），不会在运行时安装。若视觉服务未就绪，请查看引擎状态中的错误信息；依赖或权重缺失说明镜像构建不完整，需重新构建镜像",
    }
  }
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
  child.once("exit", (code) => finish(code === 0 ? "安装完成，正在启动视觉服务…" : `安装失败���������������退出码 ${code}），请查看上方日志`))
  return { started: true, message: "已开始安装视觉环境，首次需要下载 PyTorch 与模型权重，可能需要数分钟到数十分钟" }
}

/* --------------------------------- 配置推送 --------------------------------- */

export function triggerUrl() {
  const base = process.env.VIGIL_INTERNAL_URL?.trim() || `http://127.0.0.1:${process.env.PORT ?? "3000"}`
  return `${base.replace(/\/$/, "")}/api/v1/incident/trigger`
}

export function auditIngestUrl() {
  return triggerUrl().replace(/\/incident\/trigger$/, "/audit/ingest")
}

export function hitsIngestUrl() {
  return triggerUrl().replace(/\/incident\/trigger$/, "/hits/ingest")
}

/** 自动巡检通道里应交给视觉漏斗处理的通道 id */
export function monitoredStreamIds() {
  return loadStreams()
    .filter((stream) => stream.autoPatrol)
    .map((stream) => stream.id)
}

/** 只下发启用且会送检的围栏（「仅记录」不触发研判）；围栏入侵与全景行为感知并行，围栏不会裁掉围栏外的目标。 */
function workerZones() {
  return loadZones()
    .filter((zone) => zone.enabled && zone.action !== "log")
    .map((zone) => ({
      id: zone.id,
      name: zone.name,
      type: zone.type,
      cameraId: zone.cameraId,
      targets: zone.targets,
      coordinates: zone.coordinates,
      directional: zone.directional === true,
    }))
}

/** 每路通道沉淀出的补充词 / 记忆锚点 / 触发策略；没有学习内容的通道不下发。 */
function workerLearning(channelRules: Record<string, WorkerChannelRules>): Record<string, WorkerLearning> {
  const out: Record<string, WorkerLearning> = {}
  for (const [streamId, learning] of Object.entries(loadAllLearning())) {
    // 没有任何启用规则的通道不再下发历史反哺词条，避免遗留词条继续进入推理词表
    if ((channelRules[streamId]?.ruleIds.length ?? 0) === 0) continue
    if (learning.tags.length > 0 || learning.anchor) out[streamId] = toWorkerLearning(learning)
  }
  return out
}

/** 每路被监控通道的负样本锚点；没有锚点的通道不下发。 */
function workerNegativeAnchors(streamIds: string[]): Record<string, Array<{ id: string; label: string; bbox: [number, number, number, number] }>> {
  const wanted = new Set(streamIds)
  const out: Record<string, Array<{ id: string; label: string; bbox: [number, number, number, number] }>> = {}
  for (const stream of loadStreams()) {
    const anchors = stream.negativeAnchors ?? []
    if (!wanted.has(stream.id) || anchors.length === 0) continue
    out[stream.id] = anchors.map(({ id, label, bbox }) => ({ id, label, bbox }))
  }
  return out
}

/** 只下发启用且配置了通用管道的规则；boundChannels ��定管道在哪些通道上生效（ALL = 全部）。 */
function workerRulePipelines() {
  return loadRules()
    .filter((rule) => rule.enabled && rule.pipeline)
    .map((rule) => ({
      ...(rule.pipeline as RulePipelineConfig),
      id: rule.id,
      name: rule.name,
      boundChannels: rule.boundChannels ?? ["ALL"],
    }))
}

function buildPayload(config: VisionConfig) {
  const streamIds = monitoredStreamIds()
  const channelRules = workerChannelRules(streamIds)
  return {
    enabled: config.enabled,
    sampleFps: config.sampleFps,
    motionThresholdPct: config.motionThresholdPct,
    confidenceLow: config.confidenceLow,
    confidenceHigh: config.confidenceHigh,
    minConsecutiveFrames: config.minConsecutiveFrames,
    cooldownSeconds: config.cooldownSeconds,
    staticRecheckSec: config.staticRecheckSeconds,
    channelVocabulary: channelVocabularies(streamIds),
    channelRules,
    zones: workerZones(),
    streamIds,
    learning: workerLearning(channelRules),
    negativeAnchors: workerNegativeAnchors(streamIds),
    rulePipelines: workerRulePipelines(),
    go2rtcUrl: GO2RTC_URL,
    triggerUrl: triggerUrl(),
    auditMode: config.auditMode,
    auditUrl: auditIngestUrl(),
    hitsUrl: hitsIngestUrl(),
    lowLightMode: config.lowLightMode,
    debugForceBaseline: config.debugForceBaseline,
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
  // 下发即进入宽限期：Worker 在后台应用词表期间，探活失败不计入连续心跳失败
  s.graceUntil = Date.now() + RELOAD_GRACE_MS
  try {
    const response = await visionFetch("/config/reload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 20_000,
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

/** 巡检循环用：视觉漏斗是否已接���自动巡检（模型就绪才接管，否则回落到定时整段研判）。 */
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
    if (s.health.updating) return { status: s.health.status, message: "视觉服务正在后台热更新词表，期间保持在线，稍后自动恢复推理" }
    const throttle = s.health.cpuThrottled ? `（CPU 环境已限帧至 ${s.health.effectiveFps} FPS/路）` : ""
    return {
      status: s.health.status,
      message: s.health.reason || (s.health.status === "ready" ? `YOLO-World + ByteTrack 运行正常${throttle}` : "视觉服务模型加载中"),
    }
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
  if (inReloadGrace()) return { status: "loading", message: "配置热更新宽限期内，等待视觉服务响应…" }
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
    info.message = `${info.message}。Node 端已��管 Tier-0 帧差预筛：静止画面不再送审大模型，环境部署完成后自动升级为 YOLO-World + ByteTrack`
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
    hitLog: health?.hitLog ?? [],
    versions: health?.versions ?? {},
    lastReloadMs: health?.lastReloadMs ?? 0,
    restarts: s.restarts,
    installOutput: s.installing || s.installOutput ? s.installOutput : undefined,
  }
}

export type GateTrace = {
  at: string
  streamId: string
  ruleId: string
  ruleName: string
  gate: string
  verdict: "pass" | "block" | "info"
  detail: string
}

/** 规则管道门禁逐级诊断（Worker 内存环形缓冲）；Worker 不在线时返回空列表。 */
export async function getGateTraces(
  filter: { streamId?: string; ruleId?: string; limit?: number } = {},
): Promise<{ online: boolean; count: number; traces: GateTrace[] }> {
  const query = new URLSearchParams()
  if (filter.streamId) query.set("streamId", filter.streamId)
  if (filter.ruleId) query.set("ruleId", filter.ruleId)
  if (filter.limit) query.set("limit", String(filter.limit))
  try {
    const response = await visionFetch(`/gate-traces?${query.toString()}`, { timeoutMs: 2_500 })
    if (!response.ok) return { online: false, count: 0, traces: [] }
    const body = (await response.json()) as { count: number; traces: GateTrace[] }
    return { online: true, count: body.count, traces: body.traces }
  } catch {
    return { online: false, count: 0, traces: [] }
  }
}

/** 初筛命中日志轻量流：每次实时探测一次 worker，避免读到 5 秒前的缓存。 */
export async function getVisionHits(): Promise<VisionHitsResponse> {
  await ensureVisionEngine()
  const s = state()
  const live = s.child || s.healthy ? await probeHealth() : null
  if (live) {
    s.healthy = true
    s.health = live
  }
  const health = live ?? (s.healthy ? s.health : null)
  const info = describe()
  const fallback = !health && motionFallbackActive() ? motionFallbackSnapshot() : null
  const workerStreams = health?.streams ?? fallback?.streams ?? {}
  const streams = loadStreams().map((stream) => {
    const item = workerStreams[stream.id]
    return {
      id: stream.id,
      name: stream.name,
      monitored: Boolean(stream.autoPatrol),
      online: item?.online ?? false,
      frames: item?.frames ?? 0,
      ringFrames: item?.ringFrames ?? 0,
      zones: item?.zones ?? 0,
      persons: item?.persons ?? 0,
      subjects: item?.subjects ?? 0,
      rawTop: item?.rawTop ?? null,
      degraded: item?.degraded ?? false,
      inferError: item?.inferError ?? "",
      error: item?.error ?? "",
    }
  })
  return {
    status: "ok",
    online: Boolean(health),
    mode: health?.mode ?? (fallback ? "node-motion" : "offline"),
    modelLoaded: health?.modelLoaded ?? false,
    message: info.message,
    hitLog: health?.hitLog ?? [],
    recentEvents: health?.recentEvents ?? [],
    stats: health?.stats ?? fallback?.stats ?? { ...EMPTY_VISION_STATS },
    streams,
  }
}

export function visionHealthy() {
  return state().healthy
}

/** 视觉服务正在持续读到该通道的帧：说明视频流已接入并在被初筛，不应再显示为「待命」。 */
export function visionStreamOnline(streamId: string) {
  const s = state()
  return s.healthy && s.health?.streams?.[streamId]?.online === true
}
