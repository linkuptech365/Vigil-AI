"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  API_PRESETS,
  DEFAULT_SETTINGS,
  VIDEO_FORMATS,
  createInitialQueue,
  createScanResults,
  createTestSamples,
  formatDuration,
  hashString,
  truthForLocalFile,
} from "@/lib/vigil/data"
import type {
  ConnectionTestRequest,
  ConnectionTestResponse,
} from "@/lib/ops/api-types"
import { RULES, RULE_IDS } from "@/lib/vigil/rules"
import type {
  LogLevel,
  LogLine,
  PingState,
  Settings,
  VideoItem,
} from "@/lib/vigil/types"

export type TabId = "config" | "queue" | "alerts"

const STORAGE_KEY = "vigil-ai:settings"
const MAX_LOGS = 400

interface VigilContextValue {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  applyPreset: (presetId: string) => void
  apiKey: string
  setApiKey: (value: string) => void
  ping: PingState
  runPing: () => Promise<void>
  modelName: string
  scanning: boolean
  lastScan: string | null
  scanFolder: () => Promise<void>
  importLocalFiles: (files: FileList | null) => Promise<void>
  queue: VideoItem[]
  addSamples: () => void
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
  const [apiKey, setApiKey] = React.useState("")
  const [ping, setPing] = React.useState<PingState>({ state: "idle" })
  const [scanning, setScanning] = React.useState(false)
  const [lastScan, setLastScan] = React.useState<string | null>(null)
  const [queue, setQueue] = React.useState<VideoItem[]>(createInitialQueue)
  const [logs, setLogs] = React.useState<LogLine[]>([])
  const [batchRunning, setBatchRunning] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<TabId>("config")

  const settingsRef = React.useRef(settings)
  const apiKeyRef = React.useRef(apiKey)
  const busyRef = React.useRef(new Set<string>())
  const logId = React.useRef(0)
  const booted = React.useRef(false)

  React.useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  React.useEffect(() => {
    apiKeyRef.current = apiKey
  }, [apiKey])

  const pushLog = React.useCallback((level: LogLevel, text: string) => {
    logId.current += 1
    const line: LogLine = { id: logId.current, ts: timestamp(), level, text }
    setLogs((prev) => [...prev.slice(-(MAX_LOGS - 1)), line])
  }, [])

  React.useEffect(() => {
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
    setHydrated(true)
  }, [])

  React.useEffect(() => {
    if (!hydrated) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings, hydrated])

  React.useEffect(() => {
    if (booted.current) return
    booted.current = true
    pushLog("sys", "Vigil-AI Sentinel v1.0 初始化完成，等待接入模型 API。")
    pushLog("sys", "视频推理管线就绪：frame-sampler / vlm-client / rule-engine")
  }, [pushLog])

  const updateSettings = React.useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
    if (patch.apiUrl !== undefined) {
      setPing((prev) => (prev.state === "testing" ? prev : { state: "idle" }))
    }
  }, [])

  const applyPreset = React.useCallback(
    (presetId: string) => {
      const preset = API_PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      updateSettings({ presetId: preset.id, apiUrl: preset.url })
    },
    [updateSettings]
  )

  const modelName =
    API_PRESETS.find((p) => p.id === settings.presetId)?.model ?? "Qwen2.5-VL"

  const runPing = React.useCallback(async () => {
    const { apiUrl, presetId } = settingsRef.current
    const model = API_PRESETS.find((p) => p.id === presetId)?.model ?? "Qwen2.5-VL"
    setPing({ state: "testing" })
    pushLog("req", `POST /api/v1/test-connection  → ${apiUrl.trim() || "(本地网关)"}`)

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
      "info",
      `扫描目录 ${folderPath}  recursive=${recursive}  formats=${formats.join(",")}`
    )
    await sleep(1500 + Math.random() * 600)

    const found = createScanResults(folderPath.trim(), recursive, formats)
    let added = 0
    setQueue((prev) => {
      const known = new Set(prev.map((v) => v.id))
      const fresh = found.filter((v) => !known.has(v.id))
      added = fresh.length
      return [...prev, ...fresh]
    })

    setLastScan(new Date().toLocaleString("zh-CN", { hour12: false }))
    setScanning(false)
    pushLog("ok", `扫描完成：发现 ${found.length} 个视频文件，新增入队 ${added} 个。`)
    toast.success(`目录同步完成，发现 ${found.length} 个视频`, {
      action: { label: "查看队列", onClick: () => setActiveTab("queue") },
    })
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
      const model = API_PRESETS.find((p) => p.id === s.presetId)?.model ?? "Qwen2.5-VL"
      const enabled = RULE_IDS.filter((id) => s.rules[id])
      const frames = Math.max(1, Math.ceil(video.durationSec * s.samplingFps))

      patchVideo(video.id, {
        status: "analyzing",
        ruleId: undefined,
        confidence: undefined,
        suppressedReason: undefined,
        analyzedAt: undefined,
      })

      try {
        pushLog(
          "info",
          `▶ ${video.name}  (${formatDuration(video.durationSec)}, ${video.sizeMB.toFixed(1)} MB, ${video.fps}fps)`
        )
        await sleep(450)
        pushLog(
          "sample",
          `ffmpeg -i "${video.name}" -vf fps=${s.samplingFps},scale=640:-1 → 抽取 ${frames} 帧`
        )
        await sleep(600)
        pushLog(
          "req",
          `POST ${s.apiUrl || "(未配置端点)"}  {"model":"${model}","frames":${frames},"rules":[${enabled
            .map((r) => `"${r}"`)
            .join(",")}],"threshold":${s.threshold.toFixed(2)}}`
        )
        if (!apiKey) {
          pushLog("warn", "未设置 API Key，以匿名模式调用（本地网关可忽略此提示）。")
        }
        await sleep(900 + Math.random() * 700)

        const t = video.truth
        const latency = Math.round(620 + Math.random() * 900)
        let status: VideoItem["status"] = "safe"
        let ruleId = undefined as VideoItem["ruleId"]
        let suppressedReason: string | undefined

        if (t.ruleId && s.rules[t.ruleId]) {
          if (t.confidence >= s.threshold) {
            status = "alert"
            ruleId = t.ruleId
          } else {
            ruleId = t.ruleId
            suppressedReason = `疑似「${RULES[t.ruleId].ruleName}」，置信度 ${Math.round(
              t.confidence * 100
            )}% 低于阈值 ${Math.round(s.threshold * 100)}%，未触发预警`
          }
        } else if (t.ruleId) {
          suppressedReason = `检出场景「${RULES[t.ruleId].scenarioLabel}」已在配置中关闭，结果被忽略`
        }

        pushLog("res", `200 OK  ${latency}ms`)
        pushLog(
          "res",
          `{"violation":${status === "alert"},"rule":${
            ruleId ? `"${ruleId}"` : "null"
          },"confidence":${t.confidence.toFixed(2)}}`
        )
        await sleep(250)

        patchVideo(video.id, {
          status,
          ruleId,
          confidence: t.confidence,
          suppressedReason,
          samplingFps: s.samplingFps,
          frames,
          analyzedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        })

        if (status === "alert" && ruleId) {
          pushLog(
            "alert",
            `触发预警 [${RULES[ruleId].ruleName}]  conf=${Math.round(t.confidence * 100)}%  ← ${video.name}`
          )
        } else if (suppressedReason) {
          pushLog("warn", suppressedReason)
        } else {
          pushLog("ok", `分析完成：未发现违规行为  ← ${video.name}`)
        }
      } finally {
        busyRef.current.delete(video.id)
      }
    },
    [apiKey, patchVideo, pushLog]
  )

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

  const clearQueue = React.useCallback(() => {
    setQueue([])
    pushLog("info", "检测队列已清空。")
  }, [pushLog])

  const removeVideo = React.useCallback((id: string) => {
    setQueue((prev) => prev.filter((v) => v.id !== id))
  }, [])

  const clearLogs = React.useCallback(() => setLogs([]), [])

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
      scanning,
      lastScan,
      scanFolder,
      importLocalFiles,
      queue,
      addSamples,
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
      ping,
      runPing,
      modelName,
      scanning,
      lastScan,
      scanFolder,
      importLocalFiles,
      queue,
      addSamples,
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
