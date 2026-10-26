import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { resolveFfmpegPath } from "@/lib/ops/server/frame-extractor"
import { dataDir } from "@/lib/storage/rules-store"
import { visionStreamOnline } from "@/lib/vision-engine"
import { findDemoVideo, loadStreams } from "@/lib/storage/streams-store"
import {
  DEMO_STREAM_ID,
  maskRtspUrl,
  type EngineInfo,
  type EngineIssue,
  type StreamMeta,
  type StreamView,
  type StreamsResponse,
} from "@/lib/vigil/streams"

const API_HOST = "127.0.0.1"
const API_PORT = 1984
const RTSP_PORT = 8554
const WEBRTC_PORT = 8555
const API_BASE = `http://${API_HOST}:${API_PORT}`

const HEALTH_INTERVAL_MS = 5_000
const STARTUP_GRACE_MS = 12_000
const MAX_BACKOFF_MS = 30_000
const STABLE_UPTIME_MS = 60_000
const SUPPORTED_PLATFORMS = new Set([
  "win32-x64",
  "win32-ia32",
  "win32-arm64",
  "linux-x64",
  "linux-arm64",
  "linux-arm",
  "linux-ia32",
  "darwin-x64",
  "darwin-arm64",
])

interface EngineState {
  child: ChildProcess | null
  managed: boolean
  healthy: boolean
  version?: string
  startedAt: number
  restarts: number
  failures: number
  restartTimer: NodeJS.Timeout | null
  healthTimer: NodeJS.Timeout | null
  stopping: boolean
  lastError: string
  stderrTail: string[]
  hooked: boolean
  installing: Promise<{ ok: boolean; output: string }> | null
  probes: Map<string, boolean>
}

const globalStore = globalThis as typeof globalThis & { __vigilStreamEngine?: EngineState }

function state(): EngineState {
  if (!globalStore.__vigilStreamEngine) {
    globalStore.__vigilStreamEngine = {
      child: null,
      managed: false,
      healthy: false,
      startedAt: 0,
      restarts: 0,
      failures: 0,
      restartTimer: null,
      healthTimer: null,
      stopping: false,
      lastError: "",
      stderrTail: [],
      hooked: false,
      installing: null,
      probes: new Map(),
    }
  }
  return globalStore.__vigilStreamEngine
}

/* --------------------------------- 路径与配置 --------------------------------- */

export const platformKey = () => `${process.platform}-${process.arch}`

export function binDir() {
  return path.resolve(process.env.VIGIL_BIN_DIR?.trim() || path.join(process.cwd(), "bin"))
}

export function binaryPath() {
  const fromEnv = process.env.GO2RTC_BIN?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.join(binDir(), process.platform === "win32" ? "go2rtc.exe" : "go2rtc")
}

export function binaryReady() {
  try {
    return fs.statSync(binaryPath()).isFile()
  } catch {
    return false
  }
}

export function configPath() {
  return path.join(dataDir(), "go2rtc.yaml")
}

const quote = (value: string) => JSON.stringify(value)
const shellQuote = (value: string) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value)

/** 内置模拟流：把测试视频以 7x24 循环推成 RTSP；其余通道一律走用户填写的拉流地址。 */
function sourceOf(meta: StreamMeta): string | null {
  if (!meta.builtin) return meta.source || null
  const video = findDemoVideo()
  if (!video) return null
  const ffmpeg = resolveFfmpegPath()
  return `exec:${shellQuote(ffmpeg)} -re -stream_loop -1 -i ${shellQuote(video)} -c:v copy -an -rtsp_transport tcp -f rtsp {output}`
}

function writeEngineConfig() {
  const lines = [
    "# 由 Vigil-AI 自动生成，请勿手工编辑；通道请在控制台「系统核心配置」中管理。",
    "api:",
    `  listen: ${quote(`${API_HOST}:${API_PORT}`)}`,
    "rtsp:",
    `  listen: ${quote(`${API_HOST}:${RTSP_PORT}`)}`,
    "webrtc:",
    `  listen: ${quote(`${API_HOST}:${WEBRTC_PORT}`)}`,
    "srtp:",
    '  listen: ""',
    "ffmpeg:",
    `  bin: ${quote(resolveFfmpegPath())}`,
    "log:",
    "  level: warn",
    "streams:",
  ]
  let count = 0
  for (const meta of loadStreams()) {
    const source = sourceOf(meta)
    if (!source) continue
    lines.push(`  ${quote(meta.id)}: ${quote(source)}`)
    count += 1
  }
  if (count === 0) lines[lines.length - 1] = "streams: {}"
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.writeFileSync(configPath(), `${lines.join("\n")}\n`, "utf8")
}

/* ----------------------------------- HTTP ----------------------------------- */

interface FetchOptions {
  method?: string
  signal?: AbortSignal
  /** 等待响应头的超时；默认 8 秒 */
  timeoutMs?: number
}

export async function engineFetch(pathname: string, options: FetchOptions = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), options.timeoutMs ?? 8_000)
  const onAbort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) onAbort()
  else options.signal?.addEventListener("abort", onAbort, { once: true })
  try {
    return await fetch(`${API_BASE}${pathname}`, { method: options.method, signal: controller.signal, cache: "no-store" })
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", onAbort)
  }
}

async function probeHealth(): Promise<{ ok: boolean; version?: string }> {
  try {
    const response = await engineFetch("/api", { timeoutMs: 2_000 })
    if (!response.ok) return { ok: false }
    const body = (await response.json().catch(() => ({}))) as { version?: string }
    return { ok: true, version: body.version }
  } catch {
    return { ok: false }
  }
}

export interface GrabbedFrame {
  buffer: Buffer
  latencyMs: number
}

/** 从内置引擎抓取一张实时 JPEG；首帧可能需要等待上游握手，默认给 20 秒。 */
export async function grabFrame(streamId: string, options: { timeoutMs?: number; width?: number; signal?: AbortSignal } = {}) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), options.timeoutMs ?? 20_000)
  const onAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener("abort", onAbort, { once: true })
  try {
    const query = new URLSearchParams({ src: streamId })
    if (options.width) query.set("width", String(options.width))
    const response = await fetch(`${API_BASE}/api/frame.jpeg?${query}`, { signal: controller.signal, cache: "no-store" })
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().slice(0, 160)
      throw new Error(detail || `引擎返回 HTTP ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 500 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("引擎返回的不是有效的 JPEG 画面")
    state().probes.set(streamId, true)
    return { buffer, latencyMs: Date.now() - started } satisfies GrabbedFrame
  } catch (error) {
    state().probes.set(streamId, false)
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error("等待画面超时，请检查摄像头/NVR 地址与网络连通性")
    throw error instanceof Error ? error : new Error("抓帧失败")
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", onAbort)
  }
}

export function markProbe(streamId: string, ok: boolean) {
  state().probes.set(streamId, ok)
}

/* --------------------------------- 进程生命周期 --------------------------------- */

function killChild() {
  const { child } = state()
  if (child && !child.killed) {
    try {
      child.kill()
    } catch {
      // 进程已退出
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
      // 只有没有其他监听者（如 Next 自己的优雅退出）时才由我们结束进程
      if (process.listenerCount(signal) === 0) process.exit(0)
    })
  }
}

function scheduleRestart() {
  const s = state()
  if (s.stopping || s.restartTimer) return
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
  if (s.child || s.stopping) return

  const existing = await probeHealth()
  if (existing.ok) {
    s.managed = false
    s.healthy = true
    s.version = existing.version
    await syncStreams()
    return
  }

  if (!binaryReady()) return

  try {
    writeEngineConfig()
  } catch (error) {
    s.lastError = `无法写入 go2rtc 配置：${error instanceof Error ? error.message : "未知错误"}`
    return
  }

  s.stderrTail = []
  s.startedAt = Date.now()
  s.managed = true
  let child: ChildProcess
  try {
    child = spawn(binaryPath(), ["-config", configPath()], {
      cwd: dataDir(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
  } catch (error) {
    s.lastError = `go2rtc 启动失败：${error instanceof Error ? error.message : "未知错误"}`
    scheduleRestart()
    return
  }
  s.child = child

  const remember = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue
      s.stderrTail.push(line.trim().slice(0, 300))
      if (s.stderrTail.length > 6) s.stderrTail.shift()
    }
  }
  child.stdout?.on("data", remember)
  child.stderr?.on("data", remember)

  child.once("error", (error: NodeJS.ErrnoException) => {
    s.child = null
    s.healthy = false
    s.lastError =
      error.code === "EACCES"
        ? `go2rtc 没有执行权限，请执行 chmod +x ${binaryPath()}`
        : error.code === "ENOENT"
          ? "未找到 go2rtc 可执行文件"
          : `go2rtc 启动失败：${error.message}`
    scheduleRestart()
  })

  child.once("exit", (code, signal) => {
    s.child = null
    s.healthy = false
    if (s.stopping) return
    if (Date.now() - s.startedAt > STABLE_UPTIME_MS) s.failures = 0
    s.lastError = `go2rtc 进程退出（${signal ?? `code ${code}`}）${s.stderrTail.length ? `：${s.stderrTail[s.stderrTail.length - 1]}` : ""}`
    scheduleRestart()
  })
}

async function healthTick() {
  const s = state()
  if (s.stopping) return
  const result = await probeHealth()
  const wasHealthy = s.healthy
  s.healthy = result.ok
  if (result.ok) {
    s.version = result.version ?? s.version
    if (Date.now() - s.startedAt > STABLE_UPTIME_MS) s.failures = 0
    if (!wasHealthy) await syncStreams()
    return
  }
  if (!s.child && !s.restartTimer && binaryReady()) await launch()
}

/** 幂等：启动健康检查并按需拉起引擎。可在 instrumentation 与任意流接口中重复调用。 */
export async function ensureEngine(options: { waitMs?: number } = {}) {
  if (process.env.VIGIL_DISABLE_STREAM_ENGINE === "1") return
  const s = state()
  s.stopping = false
  hookProcessExit()
  if (!s.healthTimer) {
    s.healthTimer = setInterval(() => void healthTick(), HEALTH_INTERVAL_MS)
    s.healthTimer.unref?.()
  }
  if (!s.child && !s.healthy) await launch()

  const deadline = Date.now() + (options.waitMs ?? 0)
  while (!s.healthy && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const probe = await probeHealth()
    if (probe.ok) {
      s.healthy = true
      s.version = probe.version ?? s.version
    }
  }
}

export async function restartEngine() {
  const s = state()
  if (s.restartTimer) clearTimeout(s.restartTimer)
  s.restartTimer = null
  s.failures = 0
  s.stopping = true
  killChild()
  await new Promise((resolve) => setTimeout(resolve, 600))
  s.child = null
  s.healthy = false
  s.stopping = false
  await ensureEngine({ waitMs: 6_000 })
}

export function installEngine(): Promise<{ ok: boolean; output: string }> {
  const s = state()
  if (s.installing) return s.installing
  const script = path.join(process.cwd(), "scripts", "setup-go2rtc.mjs")
  s.installing = new Promise((resolve) => {
    if (!fs.existsSync(script)) {
      resolve({ ok: false, output: "找不到 scripts/setup-go2rtc.mjs，请确认部署包包含 scripts 目录" })
      return
    }
    let output = ""
    const child = spawn(process.execPath, [script], { cwd: process.cwd(), env: { ...process.env, VIGIL_BIN_DIR: binDir() }, windowsHide: true })
    const timer = setTimeout(() => child.kill(), 240_000)
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")))
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")))
    child.once("error", (error) => {
      clearTimeout(timer)
      resolve({ ok: false, output: `${output}${error.message}` })
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0 && binaryReady(), output: output.trim().slice(-800) })
    })
  }).finally(() => {
    s.installing = null
  }) as Promise<{ ok: boolean; output: string }>
  return s.installing
}

/* --------------------------------- 通道注册 --------------------------------- */

async function putStream(id: string, source: string) {
  const query = new URLSearchParams({ name: id, src: source })
  const response = await engineFetch(`/api/streams?${query}`, { method: "PUT", timeoutMs: 6_000 })
  if (!response.ok) {
    const reason = (await response.text().catch(() => "")).trim().slice(0, 200)
    throw new Error(`引擎拒绝注册通道（HTTP ${response.status}${reason ? `：${reason}` : ""}）`)
  }
}

export async function registerStream(meta: StreamMeta) {
  // 内置模拟流使用 exec: 源，go2rtc 禁止经 HTTP API 注册此类源，只能由 go2rtc.yaml 在引擎启动时加载
  if (meta.builtin) return
  const source = sourceOf(meta)
  if (!source) throw new Error("该通道没有可用的视频源")
  await ensureEngine({ waitMs: 4_000 })
  if (!state().healthy) throw new Error("流媒体引擎尚未就绪，通道已保存，引擎恢复后会自动注册")
  await putStream(meta.id, source)
}

export async function unregisterStream(id: string) {
  state().probes.delete(id)
  if (!state().healthy) return
  try {
    await engineFetch(`/api/streams?${new URLSearchParams({ src: id })}`, { method: "DELETE", timeoutMs: 6_000 })
  } catch {
    // 引擎不可达时，下次重启会以最新的 streams.json 重建配置
  }
}

async function syncStreams() {
  for (const meta of loadStreams()) {
    if (meta.builtin) continue
    const source = sourceOf(meta)
    if (!source) continue
    try {
      await putStream(meta.id, source)
    } catch (error) {
      console.error(`[stream-engine] 注册通道 ${meta.id} 失败：`, error)
    }
  }
}

/* ----------------------------------- 状态 ----------------------------------- */

function describe(): { issue?: EngineIssue; message: string; status: EngineInfo["engineStatus"] } {
  const s = state()
  if (process.env.VIGIL_DISABLE_STREAM_ENGINE === "1") {
    return { status: "degraded", issue: "disabled", message: "已通过 VIGIL_DISABLE_STREAM_ENGINE=1 关闭内置流媒体引擎" }
  }
  if (s.healthy) return { status: "running", message: "内置流媒体引擎运行正常" }
  if (!binaryReady()) {
    if (!SUPPORTED_PLATFORMS.has(platformKey())) {
      return { status: "degraded", issue: "unsupported", message: `当前平台 ${platformKey()} 没有预编译的 go2rtc，请手动放置二进制到 ${binaryPath()}` }
    }
    return { status: "degraded", issue: "binary-missing", message: "未检测到 go2rtc 二进制，请点击「一键安装引擎」，或执行 pnpm setup:engine" }
  }
  if (s.child && Date.now() - s.startedAt < STARTUP_GRACE_MS) return { status: "starting", message: "流媒体引擎正在启动..." }
  if (s.restartTimer || (!s.child && s.lastError)) {
    return { status: "degraded", issue: "crashed", message: `${s.lastError || "引擎进程已退出"}，正在自动重启（第 ${s.restarts + 1} 次）` }
  }
  if (!s.child) return { status: "starting", message: "流媒体引擎正在启动..." }
  return { status: "degraded", issue: "unreachable", message: `引擎进程已启动但 ${API_HOST}:${API_PORT} 无响应${s.stderrTail.length ? `：${s.stderrTail[s.stderrTail.length - 1]}` : ""}` }
}

export async function getEngineInfo(): Promise<EngineInfo> {
  await ensureEngine()
  const s = state()
  if (!s.healthy && s.child) {
    const probe = await probeHealth()
    s.healthy = probe.ok
    s.version = probe.version ?? s.version
  }
  const info = describe()
  return {
    engineStatus: info.status,
    issue: info.issue,
    message: info.message,
    binaryReady: binaryReady(),
    platform: SUPPORTED_PLATFORMS.has(platformKey()) ? platformKey() : "",
    version: s.version,
    restarts: s.restarts,
    managed: s.managed,
  }
}

interface RawStreamEntry {
  producers?: Array<{ medias?: unknown[]; recv?: number }>
  consumers?: unknown[] | null
}

export async function getStreamViews(): Promise<StreamsResponse> {
  const engine = await getEngineInfo()
  const metas = loadStreams()

  let live: Record<string, RawStreamEntry> = {}
  if (engine.engineStatus === "running") {
    try {
      const response = await engineFetch("/api/streams", { timeoutMs: 3_000 })
      if (response.ok) live = (await response.json()) as Record<string, RawStreamEntry>
    } catch {
      live = {}
    }
  }

  const probes = state().probes
  const streams: StreamView[] = metas.map((meta) => {
    const entry = live[meta.id]
    const connected = entry?.producers?.some((producer) => (producer.medias?.length ?? 0) > 0 || (producer.recv ?? 0) > 0) ?? false
    const visionLive = visionStreamOnline(meta.id)
  const status =
    engine.engineStatus !== "running"
      ? "offline"
      : connected || visionLive
        ? "online"
        : probes.get(meta.id) === false
          ? "offline"
          : "idle"
    return {
      id: meta.id,
      name: meta.name,
      zone: meta.zone,
      sourceMasked: meta.builtin ? `内置模拟流 · rtsp://127.0.0.1:${RTSP_PORT}/${DEMO_STREAM_ID}` : maskRtspUrl(meta.source),
      builtin: meta.builtin,
      autoPatrol: meta.autoPatrol,
      status,
      consumers: entry?.consumers?.length ?? 0,
      createdAt: meta.createdAt,
      lastAnalysis: meta.lastAnalysis,
    }
  })

  return { status: "success", engine, streams, onlineCount: streams.filter((stream) => stream.status === "online").length }
}
