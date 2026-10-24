"use client"

import * as React from "react"
import useSWR from "swr"
import { toast } from "sonner"

import { errorMessage, getJson, sendJson } from "@/lib/ops/rules-client"
import {
  VISION_ENDPOINTS,
  streamInspectUrl,
  type CompileResponse,
  type InspectResponse,
  type VisionConfig,
  type VisionConfigResponse,
  type VisionInfo,
  type VocabularyItem,
} from "@/lib/vigil/vision"

/** 视觉漏斗的配置与引擎状态：多处共享同一个 SWR key，安装/加载期间加快轮询。 */
export function useVision() {
  const { data, error, isLoading, mutate } = useSWR<VisionConfigResponse>(VISION_ENDPOINTS.config, getJson, {
    refreshInterval: (latest) => {
      const status = latest?.engine.status
      return status === "installing" || status === "starting" || status === "loading" ? 2000 : 5000
    },
    keepPreviousData: true,
  })

  const save = React.useCallback(
    async (config: VisionConfig) => {
      try {
        const response = await sendJson<VisionConfigResponse>(VISION_ENDPOINTS.config, "PUT", config)
        await mutate(response, { revalidate: false })
        if (response.reload && !response.reload.ok) toast.warning("配置已保存", { description: response.reload.message })
        else toast.success("视觉配置已保存", { description: response.reload ? `热更新完成，耗时 ${response.reload.reloadMs} ms` : "视觉服务启动后自动生效" })
        return response
      } catch (caught) {
        toast.error("保存视觉配置失败", { description: errorMessage(caught) })
        return null
      }
    },
    [mutate]
  )

  const compile = React.useCallback(
    async (instruction: string, apply: boolean, options?: { mode?: "append" | "replace"; baseVocabulary?: VocabularyItem[] }) => {
      try {
        const response = await sendJson<CompileResponse>(VISION_ENDPOINTS.compile, "POST", {
          instruction,
          apply,
          mode: options?.mode ?? "append",
          baseVocabulary: options?.baseVocabulary,
        })
        if (apply) await mutate()
        return response
      } catch (caught) {
        toast.error("编译检测词表失败", { description: errorMessage(caught) })
        return null
      }
    },
    [mutate]
  )

  const engineAction = React.useCallback(
    async (action: "install" | "restart" | "reset-stats", options?: { light?: boolean; cpu?: boolean; gpu?: boolean }) => {
      try {
        const response = await sendJson<{ started: boolean; message: string; engine: VisionInfo }>(VISION_ENDPOINTS.engine, "POST", { action, ...options })
        await mutate()
        toast[response.started ? "success" : "warning"](response.message)
        return response.engine
      } catch (caught) {
        toast.error("视觉服务操作失败", { description: errorMessage(caught) })
        return null
      }
    },
    [mutate]
  )

  const inspect = React.useCallback(async (streamId: string) => {
    try {
      return await sendJson<InspectResponse>(streamInspectUrl(streamId), "POST")
    } catch (caught) {
      toast.error("检视失败", { description: errorMessage(caught) })
      return null
    }
  }, [])

  return {
    config: data?.config,
    engine: data?.engine,
    loading: isLoading && !data,
    loadError: error ? errorMessage(error) : null,
    save,
    compile,
    engineAction,
    inspect,
    refresh: mutate,
  }
}
