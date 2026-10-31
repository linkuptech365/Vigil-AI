"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  CLIP_SECONDS,
  CLIP_T0,
  FALSE_POSITIVE_REASONS,
  INITIAL_ACTIONS,
  INITIAL_BROADCAST,
  INITIAL_DOSSIER,
  KEYFRAMES,
  QUICK_ACTION_LABEL,
  RESPONDERS,
  formatClock,
} from "@/lib/ops/dispatch-data"
import { buildGmpEvidenceArchive, triggerDownload } from "@/lib/ops/gmp-evidence-zip"
import type {
  BroadcastChannelType,
  ChannelBroadcastStatus,
  DispatchAction,
  EvidenceDossier,
  FalsePositiveFeedback,
  FalsePositiveReason,
  QuickActionType,
} from "@/lib/ops/dispatch-types"

interface DispatchContextValue {
  dossier: EvidenceDossier
  actions: DispatchAction[]
  feedback: FalsePositiveFeedback | null
  responderId: string
  setResponderId: (id: string) => void
  assignedResponderId: string | null
  dispatchToResponder: () => void
  runQuickAction: (type: QuickActionType) => void
  submitFalsePositive: (reason: FalsePositiveReason, explanation: string) => void
  resetDemo: () => void

  playhead: number
  playing: boolean
  selectedKeyframeId: string
  togglePlaying: () => void
  seek: (seconds: number) => void
  stepFrames: (frames: number) => void
  selectKeyframe: (id: string) => void

  packagingProgress: number | null
  packageEvidence: () => void
  downloadReport: () => void
  copyHash: () => void

  broadcast: ChannelBroadcastStatus[]
  firingChannel: BroadcastChannelType | null
  broadcasting: boolean
  sirenMuted: boolean
  setSirenMuted: (muted: boolean) => void
  overlayVisible: boolean
  dismissOverlay: () => void
  broadcastAll: () => void
  resetBroadcast: () => void
}

const DispatchContext = React.createContext<DispatchContextValue | null>(null)

export function useDispatch() {
  const ctx = React.useContext(DispatchContext)
  if (!ctx) throw new Error("useDispatch must be used within DispatchProvider")
  return ctx
}

const FRAME_STEP = 1 / 25
const BROADCAST_STEP_MS = 520

export function DispatchProvider({ children }: { children: React.ReactNode }) {
  const [dossier, setDossier] = React.useState<EvidenceDossier>(INITIAL_DOSSIER)
  const [actions, setActions] = React.useState<DispatchAction[]>(INITIAL_ACTIONS)
  const [feedback, setFeedback] = React.useState<FalsePositiveFeedback | null>(null)
  const [responderId, setResponderId] = React.useState(RESPONDERS[0].id)
  const [assignedResponderId, setAssignedResponderId] = React.useState<string | null>(null)

  const [playhead, setPlayhead] = React.useState(CLIP_T0)
  const [playing, setPlaying] = React.useState(false)
  const [selectedKeyframeId, setSelectedKeyframeId] = React.useState("KF-5")

  const [packagingProgress, setPackagingProgress] = React.useState<number | null>(null)

  const [broadcast, setBroadcast] = React.useState<ChannelBroadcastStatus[]>(INITIAL_BROADCAST)
  const [firingChannel, setFiringChannel] = React.useState<BroadcastChannelType | null>(null)
  const [broadcasting, setBroadcasting] = React.useState(false)
  const [sirenMuted, setSirenMuted] = React.useState(false)
  const [overlayVisible, setOverlayVisible] = React.useState(false)

  const actionSeq = React.useRef(INITIAL_ACTIONS.length)
  const timers = React.useRef<number[]>([])

  React.useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  const logAction = React.useCallback(
    (operator: string, actionType: string, notes: string) => {
      actionSeq.current += 1
      const entry: DispatchAction = {
        id: `ACT-${String(actionSeq.current).padStart(4, "0")}`,
        dossierId: INITIAL_DOSSIER.dossierId,
        operator,
        actionType,
        notes,
        timestamp: formatClock(new Date()),
      }
      setActions((prev) => [entry, ...prev])
    },
    []
  )

  const responderLabel = React.useCallback((id: string) => {
    const found = RESPONDERS.find((r) => r.id === id)
    return found ? `${found.name} (${found.role})` : id
  }, [])

  const dispatchToResponder = React.useCallback(() => {
    if (dossier.status !== "PENDING") return
    setDossier((prev) => ({ ...prev, status: "DISPATCHED" }))
    setAssignedResponderId(responderId)
    const label = responderLabel(responderId)
    logAction("值班调度员", "派工", `已将案卷派发至 ${label}，等待现场确认接单。`)
    toast.success(`已派工：${label}`)
  }, [dossier.status, responderId, responderLabel, logAction])

  const runQuickAction = React.useCallback(
    (type: QuickActionType) => {
      const status = dossier.status
      const operator = assignedResponderId ? responderLabel(assignedResponderId) : "值班调度员"
      if (type === "SIGN_OFF") {
        if (status !== "IN_PROGRESS") return
        setDossier((prev) => ({ ...prev, status: "RESOLVED" }))
        logAction(operator, QUICK_ACTION_LABEL[type], "现场确认冲突已平息，隐患已消除，案卷签收结案并写入归档库。")
        toast.success("案卷已结案并归档")
        return
      }
      if (status !== "DISPATCHED" && status !== "IN_PROGRESS") return
      setDossier((prev) => ({ ...prev, status: "IN_PROGRESS" }))
      const notes =
        type === "VOICE_INTERCOM"
          ? "已通过车间广播向越界人员喊话：请立即退出设备作业半径并停止冲突。"
          : "已向车间责任部门下发《安全隐患整改单》，要求 24 小时内提交整改回执。"
      logAction(operator, QUICK_ACTION_LABEL[type], notes)
      toast.success(`${QUICK_ACTION_LABEL[type]}已执行`)
    },
    [dossier.status, assignedResponderId, responderLabel, logAction]
  )

  const submitFalsePositive = React.useCallback(
    (reason: FalsePositiveReason, explanation: string) => {
      if (dossier.status === "RESOLVED" || dossier.status === "FALSE_POSITIVE") return
      const entry: FalsePositiveFeedback = {
        reason,
        explanation: explanation.trim(),
        submittedAt: formatClock(new Date()),
      }
      setFeedback(entry)
      setDossier((prev) => ({ ...prev, status: "FALSE_POSITIVE" }))
      logAction(
        "值班调度员",
        "标记大模型误报",
        `原因：${FALSE_POSITIVE_REASONS[reason]}${entry.explanation ? `；说明：${entry.explanation}` : ""}。样本已导出至微调数据集。`
      )
      toast.success("已标记误报并入库微调集", {
        description: "该样本将用于下一轮视觉模型主动学习与阈值校准。",
      })
    },
    [dossier.status, logAction]
  )

  // 播放头推进
  React.useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      setPlayhead((prev) => {
        const next = prev + 0.1
        if (next >= CLIP_SECONDS) {
          setPlaying(false)
          return CLIP_SECONDS
        }
        return next
      })
    }, 100)
    return () => window.clearInterval(id)
  }, [playing])

  const nearestKeyframeId = React.useCallback((seconds: number) => {
    const offset = seconds - CLIP_T0
    return KEYFRAMES.reduce((best, kf) =>
      Math.abs(kf.offsetSec - offset) < Math.abs(best.offsetSec - offset) ? kf : best
    ).id
  }, [])

  const seek = React.useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(CLIP_SECONDS, seconds))
      setPlayhead(clamped)
      setSelectedKeyframeId(nearestKeyframeId(clamped))
    },
    [nearestKeyframeId]
  )

  const stepFrames = React.useCallback(
    (frames: number) => {
      setPlaying(false)
      seek(playhead + frames * FRAME_STEP)
    },
    [playhead, seek]
  )

  const selectKeyframe = React.useCallback((id: string) => {
    const kf = KEYFRAMES.find((k) => k.id === id)
    if (!kf) return
    setPlaying(false)
    setSelectedKeyframeId(id)
    setPlayhead(CLIP_T0 + kf.offsetSec)
  }, [])

  const togglePlaying = React.useCallback(() => {
    setPlaying((prev) => {
      if (!prev && playhead >= CLIP_SECONDS) setPlayhead(0)
      return !prev
    })
  }, [playhead])

  const packageEvidence = React.useCallback(() => {
    if (packagingProgress !== null) return
    setPackagingProgress(0)
    void (async () => {
      try {
        const archive = await buildGmpEvidenceArchive(
          {
            dossier,
            keyframes: KEYFRAMES,
            actions,
            feedback,
            falsePositiveLabel: feedback ? FALSE_POSITIVE_REASONS[feedback.reason] : null,
          },
          setPackagingProgress
        )
        triggerDownload(archive.blob, archive.fileName)
        logAction(
          "值班调度员",
          "打包存证包",
          `已生成 ${archive.fileName}（${archive.entries.join("、")}），SHA-256：${archive.sha256.slice(0, 16)}…`
        )
        toast.success("GMP 存证档案包已打包并下载至本地", {
          description: `${archive.fileName} · SHA-256 ${archive.sha256.slice(0, 12)}…`,
        })
      } catch (error) {
        toast.error("存证包打包失败", {
          description: error instanceof Error ? error.message : "未知错误",
        })
      } finally {
        setPackagingProgress(null)
      }
    })()
  }, [packagingProgress, dossier, actions, feedback, logAction])

  const downloadReport = React.useCallback(() => {
    const payload = {
      dossierId: dossier.dossierId,
      incidentId: dossier.incidentId,
      channel: `${dossier.channelId} ${dossier.channelName}`,
      severity: dossier.severity,
      timestamp: dossier.timestamp,
      status: dossier.status,
      violatedClauses: dossier.violatedClauses,
      sha256: dossier.sha256Hash,
      keyframes: KEYFRAMES.map((kf) => ({
        id: kf.id,
        offsetSec: kf.offsetSec,
        label: kf.label,
        confidence: kf.confidence,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${dossier.dossierId}-report.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    toast.success("电子证据报告已下载", { description: `${dossier.dossierId}-report.json` })
  }, [dossier])

  const copyHash = React.useCallback(() => {
    const done = () =>
      toast.success("存证校验码已复制", { description: "SHA-256 校验码已写入剪贴板" })
    const fail = () => toast.error("复制失败，请手动选中校验码复制")
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(dossier.sha256Hash).then(done, fail)
    } else {
      fail()
    }
  }, [dossier.sha256Hash])

  const resetBroadcast = React.useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
    setBroadcast(INITIAL_BROADCAST)
    setFiringChannel(null)
    setBroadcasting(false)
    setOverlayVisible(false)
  }, [])

  const broadcastAll = React.useCallback(() => {
    if (broadcasting) return
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
    setBroadcast(INITIAL_BROADCAST)
    setBroadcasting(true)
    setOverlayVisible(false)

    INITIAL_BROADCAST.forEach((channel, index) => {
      const start = window.setTimeout(() => {
        setFiringChannel(channel.channelType)
      }, index * BROADCAST_STEP_MS)
      const finish = window.setTimeout(() => {
        const fired = formatClock(new Date())
        setBroadcast((prev) =>
          prev.map((c) =>
            c.channelType === channel.channelType
              ? { ...c, status: "SUCCESS", lastFiredTime: fired }
              : c
          )
        )
        if (channel.channelType === "SIREN") setOverlayVisible(true)
        if (index === INITIAL_BROADCAST.length - 1) {
          setFiringChannel(null)
          setBroadcasting(false)
          logAction("值班调度员", "全渠道联合广播", "大屏声光、Webhook、IM 机器人与现场 IoT 设备均已确认送达。")
          toast.success("全渠道联合广播已送达", {
            description: "4 个渠道全部返回成功，现场声光警号与闸机锁定已生效。",
          })
        }
      }, index * BROADCAST_STEP_MS + BROADCAST_STEP_MS - 60)
      timers.current.push(start, finish)
    })
  }, [broadcasting, logAction])

  const resetDemo = React.useCallback(() => {
    resetBroadcast()
    setDossier(INITIAL_DOSSIER)
    setActions(INITIAL_ACTIONS)
    actionSeq.current = INITIAL_ACTIONS.length
    setFeedback(null)
    setAssignedResponderId(null)
    setResponderId(RESPONDERS[0].id)
    toast("演示数据已重置")
  }, [resetBroadcast])

  const value = React.useMemo<DispatchContextValue>(
    () => ({
      dossier,
      actions,
      feedback,
      responderId,
      setResponderId,
      assignedResponderId,
      dispatchToResponder,
      runQuickAction,
      submitFalsePositive,
      resetDemo,
      playhead,
      playing,
      selectedKeyframeId,
      togglePlaying,
      seek,
      stepFrames,
      selectKeyframe,
      packagingProgress,
      packageEvidence,
      downloadReport,
      copyHash,
      broadcast,
      firingChannel,
      broadcasting,
      sirenMuted,
      setSirenMuted,
      overlayVisible,
      dismissOverlay: () => setOverlayVisible(false),
      broadcastAll,
      resetBroadcast,
    }),
    [
      dossier,
      actions,
      feedback,
      responderId,
      assignedResponderId,
      dispatchToResponder,
      runQuickAction,
      submitFalsePositive,
      resetDemo,
      playhead,
      playing,
      selectedKeyframeId,
      togglePlaying,
      seek,
      stepFrames,
      selectKeyframe,
      packagingProgress,
      packageEvidence,
      downloadReport,
      copyHash,
      broadcast,
      firingChannel,
      broadcasting,
      sirenMuted,
      overlayVisible,
      broadcastAll,
      resetBroadcast,
    ]
  )

  return <DispatchContext.Provider value={value}>{children}</DispatchContext.Provider>
}
