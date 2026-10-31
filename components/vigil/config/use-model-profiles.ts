"use client"

import * as React from "react"
import useSWR from "swr"
import { toast } from "sonner"

import type { ConnectionTestRequest, ConnectionTestResponse } from "@/lib/ops/api-types"
import { errorMessage, getJson, sendJson } from "@/lib/ops/rules-client"
import type {
  ModelProfileInput,
  ModelsListResponse,
  PublicModelProfile,
} from "@/lib/vigil/model-registry"

export const MODELS_ENDPOINT = "/api/v1/models"

export type ProfileTestResult =
  | { ok: true; latency: number; model: string; message: string }
  | { ok: false; message: string }

/** 由服务端读取档案中的 URL / Key / 模型名发起握手，浏览器不接触密钥。 */
export async function testModelProfile(id: string): Promise<ProfileTestResult> {
  try {
    const response = await fetch("/api/v1/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelProfileId: id } satisfies ConnectionTestRequest),
      signal: AbortSignal.timeout(10000),
    })
    const result = (await response.json()) as ConnectionTestResponse
    if (result.status === "success") {
      return { ok: true, latency: result.rttMs, model: result.modelDetected, message: result.message }
    }
    return { ok: false, message: result.message }
  } catch {
    return { ok: false, message: "无法连接 Vigil-AI 网关或网关响应超时" }
  }
}

/**
 * 模型网关的唯一客户端入口：配置页、全局分析、二级研判共用同一个 SWR 键，任何一处修改即时同步。
 */
export function useModelProfiles() {
  const { data, error, isLoading, mutate } = useSWR<ModelsListResponse>(MODELS_ENDPOINT, getJson)
  const profiles = React.useMemo<PublicModelProfile[]>(() => data?.profiles ?? [], [data])
  const defaultProfile = React.useMemo(
    () => profiles.find((profile) => profile.isDefault && profile.enabled) ?? null,
    [profiles]
  )

  const saveProfile = React.useCallback(
    async (id: string, input: ModelProfileInput) => {
      try {
        const response = await sendJson<ModelsListResponse>(`${MODELS_ENDPOINT}/${id}`, "PUT", input)
        await mutate(response, { revalidate: false })
        toast.success("模型配置已保存", { id: `model-saved-${id}`, duration: 1500 })
        return true
      } catch (caught) {
        toast.error("模型配置保存失败", { description: errorMessage(caught) })
        return false
      }
    },
    [mutate]
  )

  const addProfile = React.useCallback(
    async (input: ModelProfileInput) => {
      try {
        const response = await sendJson<ModelsListResponse & { id: string }>(MODELS_ENDPOINT, "POST", input)
        await mutate({ profiles: response.profiles }, { revalidate: false })
        toast.success("已添加自定义模型")
        return response.id
      } catch (caught) {
        toast.error("添加模型失败", { description: errorMessage(caught) })
        return null
      }
    },
    [mutate]
  )

  const removeProfile = React.useCallback(
    async (id: string) => {
      try {
        const response = await sendJson<ModelsListResponse>(`${MODELS_ENDPOINT}/${id}`, "DELETE")
        await mutate(response, { revalidate: false })
        toast.success("模型已删除")
        return true
      } catch (caught) {
        toast.error("删除模型失败", { description: errorMessage(caught) })
        return false
      }
    },
    [mutate]
  )

  const makeDefault = React.useCallback(
    async (id: string) => {
      try {
        const response = await sendJson<ModelsListResponse>(`${MODELS_ENDPOINT}/${id}/default`, "POST")
        await mutate(response, { revalidate: false })
        toast.success("已设为全局默认模型")
        return true
      } catch (caught) {
        toast.error("设置默认模型失败", { description: errorMessage(caught) })
        return false
      }
    },
    [mutate]
  )

  return {
    profiles,
    defaultProfile,
    loading: isLoading,
    loadError: Boolean(error),
    saveProfile,
    addProfile,
    removeProfile,
    makeDefault,
  }
}
