"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  API_PRESETS,
  DEFAULT_SETTINGS,
  VIDEO_FORMATS,
  createInitialQueue,
  createTestSamples,
  formatDuration,
  hashString,
  truthForLocalFile,
} from "@/lib/vigil/data"
import type {
  ConnectionTestRequest,
  ConnectionTestResponse,
} from "@/lib/ops/api-types"
import { GMP_AUTOSCAN_KEY, provisionGmpSuite } from "@/lib/ops/gmp-client"
import { postVideoApi } from "@/lib/ops/video-client"
import {
  analyzeVlmOnce,
  formatTimecode,
  readStoredApiKey,
  storeApiKey,
} from "@/lib/ops/vlm-client"
import type { VlmKeyframeInput } from "@/lib/ops/vlm-api-types"
import { classifyScenario } from "@/lib/ops/vlm-scenario-match"
import type {
  ExtractFramesRequest,
  ExtractFramesResponse,
  SamplingFps,
  ScanFolderRequest,
  ScanFolderResponse,
  ScannedVideoItem,
} from "@/lib/ops/video-types"
import { RULES, RULE_IDS } from "@/lib/vigil/rules"
import type {
  FrameTestState,
  LogLevel,
  LogLine,
  PingState,
  RuleId,
  ScanInfo,
  Settings,
  VideoItem,
} from "@/lib/vigil/types"
import { registerLocalVideo, releaseAllLocalVideos, releaseLocalVideo } from "@/lib/vigil/video-source"

export type TabId = "config" | "queue" | "alerts"

const STORAGE_KEY = "vigil-ai:settings"
const MODEL_STORAGE_KEY = "vigil_api_model"
const QUEUE_STORAGE_KEY = "vigil_queue_state"
const LOGS_STORAGE_KEY = "vigil_pipeline_logs"
const MAX_LOGS = 200

const LOG_LEVELS: readonly LogLevel[] = ["sys", "info", "sample", "req", "res", "ok", "warn", "alert"]

function readStoredQueue(): VideoItem[] | null {
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error("invalid queue cache")
    const items = parsed.filter(
      (v): v is VideoItem =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as VideoItem).id === "string" &&
        typeof (v as VideoItem).name === "string" &&
        typeof (v as VideoItem).path === "string"
    )
    if (items.length === 0) return null
    // 刷新或跳转时正在进行的分析请求已随页面中断，回退为待分析
    return items.map((v) => (v.status === "analyzing" ? { ...v, status: "pending" as const } : v))
  } catch {
    try {
      window.localStorage.removeItem(QUEUE_STORAGE_KEY)
    } catch {
      // 忽略
    }
    return null
  }
}

function writeStoredQueue(queue: VideoItem[]) {
  try {
    if (queue.length === 0) {
      window.localStorage.removeItem(QUEUE_STORAGE_KEY)
      return
    }
    try {
      window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue))
    } catch {
      // 配额不足时丢弃体积最大的抽帧缩略图，仍保留分析结论
      const slim = queue.map(({ keyframes: _keyframes, ...rest }) => rest)
      window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(slim))
    }
  } catch {
    // 隐私模式或存储已满：仅在当前页面内存中生效
  }
}

function readStoredLogs(): LogLine[] {
  try {
    const raw = window.localStorage.getItem(LOGS_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error("invalid log cache")
    return parsed
      .filter(
        (l): l is LogLine =>
          typeof l === "object" &&
          l !== null &&
          typeof (l as LogLine).id === "number" &&
          typeof (l as LogLine).ts === "string" &&
          typeof (l as LogLine).text === "string" &&
          LOG_LEVELS.includes((l as LogLine).level)
      )
      .slice(-MAX_LOGS)
  } catch {
    try {
      window.localStorage.removeItem(LOGS_STORAGE_KEY)
    } catch {
      // 忽略
    }
    return []
  }
}

function writeStoredLogs(logs: LogLine[]) {
  try {
    if (logs.length === 0) {
      window.localStorage.removeItem(LOGS_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(logs.slice(-MAX_LOGS)))
  } catch {
    // 隐私模式或存储已满：仅在当前页面内存中生效
  }
}

interface VigilContextValue {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  applyPreset: (presetId: string) => void
  apiKey: string
  setApiKey: (value: string) => void
  ping: PingState
  runPing: () => Promise<void>
  modelName: string
  setModelName: (value: string) => void
  scanning: boolean
  lastScan: string | null
  scanInfo: ScanInfo | null
  scanFolder: () => Promise<void>
  frameTest: FrameTestState | null
  openFrameTest: (video: VideoItem) => void
  runFrameTest: (video: VideoItem, fps: SamplingFps, triggerSec: number | null) => Promise<void>
  closeFrameTest: () => void
  importLocalFiles: (files: FileList | null) => Promise<void>
  queue: VideoItem[]
  addSamples: () => void
  loadGmpSuite: () => Promise<void>
  loadingGmp: boolean
  clearQueue: () => void
  removeVideo: (id: string) => void
  analyzeOne: (video: VideoItem) => Promise<void>
  analyzeAll: () => Promise<void>
  batchRunning: boolean
  logs: LogLine[]
  clearLogs: () => void
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
}

const VigilContext = React.createContext<VigilContextValue | null>(null)

export function useVigil() {
  const ctx = React.useContext(VigilContext)
  if (!ctx) throw new Error("useVigil must be used within VigilProvider")
  return ctx
}

const MAX_VLM_FRAMES = 16

function toVlmFrames(video: VideoItem): VlmKeyframeInput[] {
  const extracted = video.keyframes
  if (extracted && extracted.length > 0) {
    const stride = Math.max(1, Math.ceil(extracted.length / MAX_VLM_FRAMES))
    return extracted
      .filter((_, i) => i % stride === 0)
      .map((k) => ({
        index: k.index,
        timestampSec: k.timestampSec,
        timecode: k.timecode,
        motionScore: k.motionScore,
      }))
  }
  const count = Math.min(8, Math.max(2, Math.ceil(video.durationSec / 3)))
  return Array.from({ length: count }, (_, i) => {
    const timestampSec = Number(((video.durationSec * (i + 0.5)) / count).toFixed(1))
    return { index: i, timestampSec, timecode: formatTimecode(timestampSec) }
  })
}

function toQueueItem(scanned: ScannedVideoItem, scanRoot: string): VideoItem {
  return {
    id: scanned.id,
    name: scanned.name,
    path: scanned.path,
    durationSec: scanned.durationSeconds,
    sizeMB: scanned.sizeBytes / (1024 * 1024),
    fps: 25,
    recordedAt: new Date(scanned.lastModified).toLocaleString("zh-CN", { hour12: false }),
    truth: truthForLocalFile(scanned.name),
    status: "pending",
    source: "disk",
    scanRoot,
    format: scanned.format,
    resolution: scanned.resolution,
    durationEstimated: scanned.durationSource === "estimated",
  }
}

function mergeScan(prev: VideoItem[], incoming: VideoItem[], scanRoot: string): VideoItem[] {
  const known = new Map(prev.map((v) => [v.id, v]))
  const kept = prev.filter((v) => v.scanRoot !== scanRoot)
  return [...kept, ...incoming.map((item) => known.get(item.id) ?? item)]
}

function timestamp() {
  const d = new Date()
  const pad = (n: number, l = 2) => String(n).padStart(l, "0")
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const fallback = 10 + (hashString(file.name) % 25)
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    const finish = (value: number) => {
      URL.revokeObjectURL(url)
      video.removeAttribute("src")
      resolve(value)
    }
    const timer = setTimeout(() => finish(fallback), 1500)
    video.preload = "metadata"
    video.onloadedmetadata = () => {
      clearTimeout(timer)
      finish(Number.isFinite(video.duration) ? Math.round(video.duration) : fallback)
    }
    video.onerror = () => {
      clearTimeout(timer)
      finish(fallback)
    }
    video.src = url
  })
}

export function VigilProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = React.useState<Settings>(DEFAULT_SETTINGS)
  const [hydrated, setHydrated] = React.useState(false)
  const [apiKey, setApiKeyState] = React.useState("")
  const [modelName, setModelNameState] = React.useState(API_PRESETS[0].model)
  const [ping, setPing] = React.useState<PingState>({ state: "idle" })
  const [scanning, setScanning] = React.useState(false)
  const [loadingGmp, setLoadingGmp] = React.useState(false)
  const [lastScan, setLastScan] = React.useState<string | null>(null)
  const [scanInfo, setScanInfo] = React.useState<ScanInfo | null>(null)
  const [frameTest, setFrameTest] = React.useState<FrameTestState | null>(null)
  const [queue, setQueue] = React.useState<VideoItem[]>(createInitialQueue)
  const [logs, setLogs] = React.useState<LogLine[]>([])
  const [batchRunning, setBatchRunning] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<TabId>("config")

  const settingsRef = React.useRef(settings)
  const apiKeyRef = React.useRef(apiKey)
  const modelNameRef = React.useRef(modelName)
  const queueRef = React.useRef(queue)
  const frameTestToken = React.useRef(0)
  const busyRef = React.useRef(new Set<string>())
  const logId = React.useRef(0)
  const hydrateStarted = React.useRef(false)

  React.useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  React.useEffect(() => {
    apiKeyRef.current = apiKey
  }, [apiKey])

  React.useEffect(() => {
    modelNameRef.current = modelName
  }, [modelName])

  React.useEffect(() => {
    queueRef.current = queue
  }, [queue])

  const pushLog = React.useCallback((level: LogLevel, text: string) => {
    logId.current += 1
    const line: LogLine = { id: logId.current, ts: timestamp(), level, text }
    setLogs((prev) => [...prev.slice(-(MAX_LOGS - 1)), line])
  }, [])

  React.useEffect(() => {
    if (hydrateStarted.current) return
    hydrateStarted.current = true
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Settings>
        setSettings((prev) => ({
          ...prev,
          ...saved,
          rules: { ...prev.rules, ...saved.rules },
        }))
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY)
    }
    try {
      const savedModel = window.localStorage.getItem(MODEL_STORAGE_KEY)
      if (savedModel !== null) {
        modelNameRef.current = savedModel
        setModelNameState(savedModel)
      }
    } catch {
      // 隐私模式下 localStorage 不可读，沿用默认预设的模型名
    }
    setApiKeyState(readStoredApiKey())

    const storedQueue = readStoredQueue()
    if (storedQueue) {
      queueRef.current = storedQueue
      setQueue(storedQueue)
    }

    const storedLogs = readStoredLogs()
    if (storedLogs.length > 0) {
      logId.current = storedLogs.reduce((max, l) => Math.max(max, l.id), 0)
      setLogs(storedLogs)
    } else {
      pushLog("sys", "Vigil-AI Sentinel v1.0 初始化完成，等待接入模型 API。")
      pushLog("sys", "视频推理管线就绪：frame-sampler / vlm-client / rule-engine")
    }
    setHydrated(true)
  }, [pushLog])

  React.useEffect(() => {
    if (!hydrated) return
    writeStoredQueue(queue)
  }, [queue, hydrated])

  React.useEffect(() => {
    if (!hydrated) return
    writeStoredLogs(logs)
  }, [logs, hydrated])

  const setApiKey = React.useCallback((value: string) => {
    setApiKeyState(value)
    storeApiKey(value)
  }, [])

  React.useEffect(() => {
    if (!hydrated) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings, hydrated])

  const updateSettings = React.useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
    if (patch.folderPath !== undefined) setScanInfo(null)
    if (patch.apiUrl !== undefined) {
      setPing((prev) => (prev.state === "testing" ? prev : { state: "idle" }))
    }
  }, [])

  const setModelName = React.useCallback((value: string) => {
    modelNameRef.current = value
    setModelNameState(value)
    setPing((prev) => (prev.state === "testing" ? prev : { state: "idle" }))
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, value)
    } catch {
      // 隐私模式下 localStorage 不可写，仅在当前页面内存中生效
    }
  }, [])

  const applyPreset = React.useCallback(
    (presetId: string) => {
      const preset = API_PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      updateSettings({ presetId: preset.id, apiUrl: preset.url })
      setModelName(preset.model)
    },
    [updateSettings, setModelName]
  )

  const runPing = React.useCallback(async () => {
    const { apiUrl } = settingsRef.current
    const model = modelNameRef.current.trim() || undefined
    setPing({ state: "testing" })
    pushLog(
      "req",
      `POST /api/v1/test-connection  → ${apiUrl.trim() || "(本地网关)"}  model=${model ?? "(网关默认)"}`
    )

    const reportFailure = (message: string) => {
      setPing({ state: "error", message })
      pushLog("warn", `连通失败：${message}`)
      toast.error("API 连通失败", {
        description: `${message}。请检查端点地址拼写或网络防火墙。`,
      })
    }

    try {
      const response = await fetch("/api/v1/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiUrl,
          apiKey: apiKeyRef.current || undefined,
          modelName: model,
        } satisfies ConnectionTestRequest),
        signal: AbortSignal.timeout(8000),
      })
      const result = (await response.json()) as ConnectionTestResponse

      if (result.status === "success") {
        setPing({
          state: "ok",
          latency: result.rttMs,
          model: result.modelDetected,
          message: result.message,
        })
        pushLog("ok", `握手成功  RTT ${result.rttMs}ms  model=${result.modelDetected}  ${result.message}`)
        toast.success(`API 握手成功 · RTT ${result.rttMs}ms`, { description: result.message })
        return
      }
      reportFailure(result.message)
    } catch {
      reportFailure("无法连接 Vigil-AI 网关或网关响应超时")
    }
  }, [pushLog])

  const scanFolder = React.useCallback(async () => {
    const { folderPath, recursive, formats } = settingsRef.current
    if (!folderPath.trim()) {
      toast.error("请先填写目标视频目录")
      return
    }
    if (formats.length === 0) {
      toast.error("请至少选择一种视频格式")
      return
    }
    setScanning(true)
    pushLog(
      "req",
      `POST /api/v1/scan-folder  folderPath=${folderPath.trim()}  recursive=${recursive}  formats=${formats.join(",")}`
    )

    try {
      const result = await postVideoApi<ScanFolderRequest, ScanFolderResponse>(
        "/api/v1/scan-folder",
        { folderPath: folderPath.trim(), recursive, filterExtensions: formats },
        30000
      )
      const incoming = result.videos.map((v) => toQueueItem(v, result.folderPath))
      const knownIds = new Set(queueRef.current.map((v) => v.id))
      const added = incoming.filter((v) => !knownIds.has(v.id)).length
      setQueue((prev) => mergeScan(prev, incoming, result.folderPath))

      setLastScan(new Date(result.scannedAt).toLocaleString("zh-CN", { hour12: false }))
      setScanInfo({ count: result.totalFound, folder: result.folderPath, truncated: result.truncated })
      pushLog(
        "ok",
        `200 OK  扫描完成：${result.folderPath} 下发现 ${result.totalFound} 个视频文件，新增入队 ${added} 个。${
          result.truncated ? "（已达 100 个上限，结果被截断）" : ""
        }`
      )
      if (result.totalFound === 0) {
        toast.warning("目录已连通，但未发现匹配格式的视频文件")
      } else {
        toast.success(`成功同步目录，共发现 ${result.totalFound} 个视频文件`, {
          action: { label: "查看队列", onClick: () => setActiveTab("queue") },
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "扫描失败"
      setScanInfo(null)
      pushLog("warn", `扫描失败：${message}`)
      toast.error(message)
    } finally {
      setScanning(false)
    }
  }, [pushLog])

  const importLocalFiles = React.useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      const allowed = settingsRef.current.formats.length
        ? settingsRef.current.formats
        : VIDEO_FORMATS
      const candidates = Array.from(files)
        .filter((f) => allowed.some((ext) => f.name.toLowerCase().endsWith(ext)))
        .slice(0, 40)

      if (candidates.length === 0) {
        toast.error("所选文件夹中没有符合格式的视频文件")
        return
      }

      const root =
        (candidates[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0] ||
        "本机文件夹"
      pushLog("info", `读取本机目录「${root}」，匹配到 ${candidates.length} 个视频文件。`)

      const durations = await Promise.all(candidates.map(readVideoDuration))
      const items: VideoItem[] = candidates.map((file, i) => {
        const rel =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        return {
          id: `local-${rel}-${file.size}`,
          name: file.name,
          path: `[本机] ${rel}`,
          durationSec: durations[i],
          sizeMB: file.size / (1024 * 1024),
          fps: 25,
          recordedAt: new Date(file.lastModified).toLocaleString("zh-CN", { hour12: false }),
          truth: truthForLocalFile(file.name),
          status: "pending",
        }
      })

      candidates.forEach((file, i) => registerLocalVideo(items[i].id, file))
      setQueue((prev) => {
        const known = new Set(prev.map((v) => v.id))
        return [...prev, ...items.filter((v) => !known.has(v.id))]
      })
      setSettings((prev) => ({ ...prev, folderPath: `[本机] ${root}` }))
      setLastScan(new Date().toLocaleString("zh-CN", { hour12: false }))
      toast.success(`已从本机载入 ${items.length} 个视频`, {
        action: { label: "查看队列", onClick: () => setActiveTab("queue") },
      })
    },
    [pushLog]
  )

  const patchVideo = React.useCallback((id: string, patch: Partial<VideoItem>) => {
    setQueue((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)))
  }, [])

  const analyzeOne = React.useCallback(
    async (video: VideoItem) => {
      if (busyRef.current.has(video.id)) return
      busyRef.current.add(video.id)

      const s = settingsRef.current
      const model = modelNameRef.current.trim() || undefined
      const enabled = RULE_IDS.filter((id) => s.rules[id])
      const frames = Math.max(1, Math.ceil(video.durationSec * s.samplingFps))

      patchVideo(video.id, {
        status: "analyzing",
        ruleId: undefined,
        confidence: undefined,
        suppressedReason: undefined,
        analyzedAt: undefined,
      })

      let keyframes: VideoItem["keyframes"]
      let keyframeWindow: VideoItem["keyframeWindow"]

      try {
        pushLog(
          "info",
          `▶ ${video.name}  (${formatDuration(video.durationSec)}, ${video.sizeMB.toFixed(1)} MB, ${video.fps}fps)`
        )
        if (video.source === "disk") {
          try {
            const result = await postVideoApi<ExtractFramesRequest, ExtractFramesResponse>(
              "/api/v1/extract-frames",
              { videoPath: video.path, fps: s.samplingFps as SamplingFps }
            )
            keyframes = result.keyframes
            keyframeWindow = result.windowRange
            pushLog(
              "sample",
              `POST /api/v1/extract-frames → ${result.totalFramesExtracted} 帧  窗口 [${result.windowRange.startSec}s, ${result.windowRange.endSec}s]  fps=${result.samplingFps}`
            )
          } catch (error) {
            pushLog(
              "warn",
              `抽帧接口失败：${error instanceof Error ? error.message : "未知错误"}，继续以元数据完成分析。`
            )
          }
        } else {
          pushLog(
            "sample",
            `ffmpeg -i "${video.name}" -vf fps=${s.samplingFps},scale=640:-1 → 抽取 ${frames} 帧`
          )
        }
        const vlmFrames = toVlmFrames({ ...video, keyframes })
        const truth = video.truth
        pushLog(
          "req",
          `POST /api/v1/vlm/analyze  model=${model ?? "(网关默认)"}  frames=${vlmFrames.length}  rules=[${enabled
            .map((r) => `"${r}"`)
            .join(",")}]  threshold=${s.threshold.toFixed(2)}`
        )
        if (!apiKeyRef.current) {
          pushLog("warn", "未设置 API Key，以匿名模式调用（本地网关可忽略此提示）。")
        }

        const { result, metrics } = await analyzeVlmOnce({
          keyframes: vlmFrames,
          apiUrl: s.apiUrl.trim() || undefined,
          apiKey: apiKeyRef.current || undefined,
          modelName: model,
          ruleScenario: enabled.map((id) => RULES[id].scenarioLabel).join("、"),
          simulation: {
            scenario: truth.ruleId ? RULES[truth.ruleId].scenarioLabel : "画面正常",
            confidence: truth.confidence,
          },
        })
        const reasoning = result.intentAnalysis

        if (metrics.source === "fallback") {
          pushLog("warn", `未使用远端模型：${metrics.fallbackReason ?? "未配置可用端点"}，已切换离线模拟引擎。`)
        }
        pushLog(
          "res",
          `200 OK  ${metrics.rttMs}ms  source=${metrics.source}  tokens=${metrics.promptTokens}+${metrics.outputTokens}`
        )
        pushLog(
          "res",
          `{"severity":"${result.severity}","rule":"${result.ruleTriggered}","confidence":${result.confidence.toFixed(2)}}`
        )

        const kind = classifyScenario(`${result.ruleTriggered} ${result.summary}`)
        const detected: RuleId | undefined =
          result.severity === "SAFE" || kind === "safe" || kind === "crowd" ? undefined : kind
        let status: VideoItem["status"] = "safe"
        let ruleId: VideoItem["ruleId"]
        let suppressedReason: string | undefined

        if (result.severity !== "SAFE") {
          if (detected && s.rules[detected]) {
            ruleId = detected
            if (result.confidence >= s.threshold) {
              status = "alert"
            } else {
              suppressedReason = `疑似「${RULES[detected].ruleName}」，置信度 ${Math.round(
                result.confidence * 100
              )}% 低于阈值 ${Math.round(s.threshold * 100)}%，未触发预警`
            }
          } else if (detected) {
            suppressedReason = `检出场景「${RULES[detected].scenarioLabel}」已在配置中关闭，结果被忽略`
          } else {
            suppressedReason = `模型判定「${result.ruleTriggered}」不在已启用的规则范围内，未触发预警`
          }
        }

        patchVideo(video.id, {
          status,
          ruleId,
          confidence: result.confidence,
          suppressedReason,
          samplingFps: s.samplingFps,
          frames,
          keyframes,
          keyframeWindow,
          vlmReport: { result, metrics, reasoning },
          analyzedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        })

        if (status === "alert" && ruleId) {
          pushLog(
            "alert",
            `触发预警 [${RULES[ruleId].ruleName}]  conf=${Math.round(result.confidence * 100)}%  ← ${video.name}`
          )
        } else if (suppressedReason) {
          pushLog("warn", suppressedReason)
        } else {
          pushLog("ok", `分析完成：未发现违规行为  ← ${video.name}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "分析失败"
        patchVideo(video.id, { status: "pending" })
        pushLog("warn", `分析失败：${message}  ← ${video.name}`)
        toast.error(`${video.name} 分析失败`, { description: message })
      } finally {
        busyRef.current.delete(video.id)
      }
    },
    [apiKey, patchVideo, pushLog]
  )

  const runFrameTest = React.useCallback(
    async (video: VideoItem, fps: SamplingFps, triggerSec: number | null) => {
      const token = ++frameTestToken.current
      setFrameTest({ videoId: video.id, fps, triggerSec, status: "loading" })
      pushLog(
        "req",
        `POST /api/v1/extract-frames  videoPath=${video.path}  fps=${fps}${
          triggerSec !== null ? `  trigger=${triggerSec}s` : ""
        }`
      )
      try {
        const result = await postVideoApi<ExtractFramesRequest, ExtractFramesResponse>(
          "/api/v1/extract-frames",
          {
            videoPath: video.path,
            fps,
            ...(triggerSec !== null ? { triggerTimestampSec: triggerSec } : {}),
          }
        )
        if (token !== frameTestToken.current) return
        setFrameTest({
          videoId: video.id,
          fps,
          triggerSec,
          status: "ok",
          keyframes: result.keyframes,
          windowRange: result.windowRange,
          triggerTimestampSec: result.triggerTimestampSec,
        })
        pushLog(
          "sample",
          `200 OK  ${result.totalFramesExtracted} 帧  窗口 [${result.windowRange.startSec}s, ${result.windowRange.endSec}s]  ← ${video.name}`
        )
      } catch (error) {
        if (token !== frameTestToken.current) return
        const message = error instanceof Error ? error.message : "抽帧失败"
        setFrameTest({ videoId: video.id, fps, triggerSec, status: "error", error: message })
        pushLog("warn", `抽帧失败：${message}`)
      }
    },
    [pushLog]
  )

  const openFrameTest = React.useCallback(
    (video: VideoItem) => {
      void runFrameTest(video, settingsRef.current.samplingFps as SamplingFps, null)
    },
    [runFrameTest]
  )

  const closeFrameTest = React.useCallback(() => {
    frameTestToken.current += 1
    setFrameTest(null)
  }, [])

  const analyzeAll = React.useCallback(async () => {
    const pending = queue.filter((v) => v.status === "pending")
    if (pending.length === 0) {
      toast.info("队列中没有待分析的视频")
      return
    }
    setBatchRunning(true)
    pushLog("sys", `批量分析启动：共 ${pending.length} 个待处理视频，顺序执行。`)
    for (const video of pending) {
      await analyzeOne(video)
    }
    pushLog("sys", "批量分析结束。")
    setBatchRunning(false)
    toast.success("全量分析完成")
  }, [queue, analyzeOne, pushLog])

  const addSamples = React.useCallback(() => {
    const samples = createTestSamples(3)
    setQueue((prev) => [...prev, ...samples])
    pushLog("info", `已注入 ${samples.length} 个测试样本。`)
    toast.success(`已注入 ${samples.length} 个测试样本`)
  }, [pushLog])

  const loadGmpSuite = React.useCallback(async () => {
    setLoadingGmp(true)
    pushLog("req", "POST /api/v1/samples/provision  suite=vaccine-cleanroom-gmp")
    try {
      const suite = await provisionGmpSuite()
      pushLog("ok", `200 OK  已写入 ${suite.cases.length} 个 GMP 算例至 ${suite.directory}，规则库已含 RULE-BIO-01~04。`)
      settingsRef.current = { ...settingsRef.current, folderPath: suite.directory }
      updateSettings({ folderPath: suite.directory })
      setActiveTab("queue")
      await scanFolder()
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误"
      pushLog("warn", `GMP 算例载入失败：${message}`)
      toast.error("GMP 算例载入失败", { description: message })
    } finally {
      setLoadingGmp(false)
    }
  }, [pushLog, updateSettings, scanFolder])

  React.useEffect(() => {
    if (!hydrated) return
    if (window.sessionStorage.getItem(GMP_AUTOSCAN_KEY) !== "1") return
    window.sessionStorage.removeItem(GMP_AUTOSCAN_KEY)
    setActiveTab("queue")
    void scanFolder()
  }, [hydrated, scanFolder])

  const clearQueue = React.useCallback(() => {
    queueRef.current = []
    releaseAllLocalVideos()
    setQueue([])
    writeStoredQueue([])
    pushLog("info", "检测队列已清空。")
  }, [pushLog])

  const removeVideo = React.useCallback((id: string) => {
    releaseLocalVideo(id)
    setQueue((prev) => prev.filter((v) => v.id !== id))
  }, [])

  const clearLogs = React.useCallback(() => {
    setLogs([])
    writeStoredLogs([])
  }, [])

  const value = React.useMemo<VigilContextValue>(
    () => ({
      settings,
      updateSettings,
      applyPreset,
      apiKey,
      setApiKey,
      ping,
      runPing,
      modelName,
      setModelName,
      scanning,
      lastScan,
      scanInfo,
      scanFolder,
      frameTest,
      openFrameTest,
      runFrameTest,
      closeFrameTest,
      importLocalFiles,
      queue,
      addSamples,
      loadGmpSuite,
      loadingGmp,
      clearQueue,
      removeVideo,
      analyzeOne,
      analyzeAll,
      batchRunning,
      logs,
      clearLogs,
      selectedId,
      setSelectedId,
      activeTab,
      setActiveTab,
    }),
    [
      settings,
      updateSettings,
      applyPreset,
      apiKey,
      setApiKey,
      ping,
      runPing,
      modelName,
      setModelName,
      scanning,
      lastScan,
      scanInfo,
      scanFolder,
      frameTest,
      openFrameTest,
      runFrameTest,
      closeFrameTest,
      importLocalFiles,
      queue,
      addSamples,
      loadGmpSuite,
      loadingGmp,
      clearQueue,
      removeVideo,
      analyzeOne,
      analyzeAll,
      batchRunning,
      logs,
      clearLogs,
      selectedId,
      activeTab,
    ]
  )

  return <VigilContext.Provider value={value}>{children}</VigilContext.Provider>
}
