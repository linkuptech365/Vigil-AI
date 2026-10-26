"use client"

import * as React from "react"
import useSWR from "swr"
import { toast } from "sonner"

import { errorMessage, getJson, sendJson } from "@/lib/ops/rules-client"
import type {
  AnalyzeStreamResponse,
  EngineInfo,
  StreamAlert,
  StreamAlertsResponse,
  StreamAnalysisRecord,
  StreamsResponse,
  StreamTestResult,
} from "@/lib/vigil/streams"

export const STREAMS_ENDPOINT = "/api/v1/streams"
export const STREAM_ALERTS_ENDPOINT = "/api/v1/stream-alerts"

export function streamMjpegUrl(id: string) {
  return `${STREAMS_ENDPOINT}/${encodeURIComponent(id)}/mjpeg`
}

export function streamSnapshotUrl(id: string) {
  return `${STREAMS_ENDPOINT}/${encodeURIComponent(id)}/snapshot`
}

/** index 为 1 起始，与封存时的 1.jpg、2.jpg 命名一致 */
export function alertFrameUrl(alertId: string, index: number) {
  return `${STREAM_ALERTS_ENDPOINT}/${encodeURIComponent(alertId)}/frames/${index}`
}

export interface StreamAnalysisOutcome {
  streamId: string
  verdict: "alert" | "safe"
  summary: string
}

/** 通道列表与引擎状态：多处共享同一个 SWR key，每 5 秒刷新一次在线状态。 */
export function useStreams() {
  const { data, error, isLoading, mutate } = useSWR<StreamsResponse>(STREAMS_ENDPOINT, getJson, {
    refreshInterval: 5000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
  const { data: alertData, mutate: mutateAlerts } = useSWR<StreamAlertsResponse>(STREAM_ALERTS_ENDPOINT, getJson, {
    refreshInterval: 3000,
    keepPreviousData: true,
  })

  const [analyzingIds, setAnalyzingIds] = React.useState<ReadonlySet<string>>(new Set())

  const addStream = React.useCallback(
    async (input: { name: string; zone: string; source: string }) => {
      try {
        const response = await sendJson<StreamsResponse & { created: string; warning?: string }>(STREAMS_ENDPOINT, "POST", input)
        await mutate(response, { revalidate: false })
        if (response.warning) toast.warning("通道已保存", { description: response.warning })
        else toast.success(`已接入摄像头「${input.name}」`)
        return true
      } catch (caught) {
        toast.error("接入摄像头失败", { description: errorMessage(caught) })
        return false
      }
    },
    [mutate]
  )

  const removeStream = React.useCallback(
    async (id: string) => {
      try {
        const response = await sendJson<StreamsResponse>(`${STREAMS_ENDPOINT}/${encodeURIComponent(id)}`, "DELETE")
        await Promise.all([mutate(response, { revalidate: false }), mutateAlerts()])
        toast.success("通道已移除")
      } catch (caught) {
        toast.error("移除通道失败", { description: errorMessage(caught) })
      }
    },
    [mutate, mutateAlerts]
  )

  const setAutoPatrol = React.useCallback(
    async (id: string, autoPatrol: boolean) => {
      try {
        const response = await fetch(`${STREAMS_ENDPOINT}/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoPatrol }),
        })
        const payload = (await response.json()) as StreamsResponse & { message?: string }
        if (!response.ok) throw new Error(payload.message ?? `HTTP ${response.status}`)
        await mutate(payload, { revalidate: false })
      } catch (caught) {
        toast.error("切换自动巡检失败", { description: errorMessage(caught) })
      }
    },
    [mutate]
  )

  const testStream = React.useCallback(async (id: string): Promise<StreamTestResult> => {
    try {
      const result = await sendJson<StreamTestResult>(`${STREAMS_ENDPOINT}/${encodeURIComponent(id)}/test`, "POST")
      void mutate()
      return result
    } catch (caught) {
      return { ok: false, latencyMs: 0, message: errorMessage(caught) }
    }
  }, [mutate])

  const analyzeStream = React.useCallback(
    async (id: string): Promise<StreamAnalysisOutcome | null> => {
      setAnalyzingIds((prev) => new Set(prev).add(id))
      try {
        const response = await sendJson<AnalyzeStreamResponse>(`${STREAMS_ENDPOINT}/${encodeURIComponent(id)}/analyze`, "POST", {})
        await Promise.all([mutate(), mutateAlerts()])
        return { streamId: id, verdict: response.verdict, summary: response.summary }
      } catch (caught) {
        toast.error("实时研判失败", { description: errorMessage(caught) })
        return null
      } finally {
        setAnalyzingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [mutate, mutateAlerts]
  )

  const engineAction = React.useCallback(
    async (action: "install" | "restart"): Promise<EngineInfo | null> => {
      try {
        const response = await sendJson<{ engine: EngineInfo }>(`${STREAMS_ENDPOINT}/engine`, "POST", { action })
        await mutate()
        return response.engine
      } catch (caught) {
        toast.error(action === "install" ? "引擎安装失败" : "引擎重启失败", { description: errorMessage(caught) })
        return null
      }
    },
    [mutate]
  )

  const alertAction = React.useCallback(
    async (alertId: string, body: Record<string, unknown>): Promise<StreamAlert | null> => {
      try {
        const response = await fetch(`${STREAM_ALERTS_ENDPOINT}/${encodeURIComponent(alertId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const payload = (await response.json()) as { alert?: StreamAlert; message?: string }
        if (!response.ok || !payload.alert) throw new Error(payload.message ?? `HTTP ${response.status}`)
        await mutateAlerts()
        return payload.alert
      } catch (caught) {
        toast.error("案卷操作失败", { description: errorMessage(caught) })
        return null
      }
    },
    [mutateAlerts]
  )

  const streams = data?.streams ?? []
  const alerts: StreamAlert[] = alertData?.alerts ?? []
  const records: StreamAnalysisRecord[] = alertData?.records ?? []

  return {
    records,
    alertAction,
    refreshAlerts: mutateAlerts,
    engine: data?.engine,
    streams,
    onlineCount: data?.onlineCount ?? 0,
    alerts,
    loading: isLoading,
    loadError: Boolean(error) && !data,
    analyzingIds,
    addStream,
    removeStream,
    setAutoPatrol,
    testStream,
    analyzeStream,
    engineAction,
  }
}
