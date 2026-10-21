import { loadProfiles, writeProfiles } from "@/lib/storage/model-store"
import {
  MODEL_PROVIDERS,
  maskKey,
  type ModelProfile,
  type ModelProfileInput,
  type ModelProvider,
  type PublicModelProfile,
} from "@/lib/vigil/model-registry"

export class ModelProfileError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ModelProfileError"
    this.status = status
    this.code = code
  }
}

export function toPublic(profile: ModelProfile): PublicModelProfile {
  const { apiKey, ...rest } = profile
  return { ...rest, hasKey: apiKey.length > 0, keyHint: maskKey(apiKey) }
}

export function listProfiles() {
  return loadProfiles()
}

export function getProfile(id: string) {
  return loadProfiles().find((p) => p.id === id) ?? null
}

/** 把用户填写的 Base URL 补全为推理引擎可直接请求的端点。 */
export function resolveEndpointUrl(profile: Pick<ModelProfile, "provider" | "baseUrl">) {
  const raw = profile.baseUrl.trim()
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw
  }
  const pathname = url.pathname.replace(/\/+$/, "")
  if (profile.provider === "ollama" && !pathname.endsWith("/api/chat")) {
    url.pathname = `${pathname}/api/chat`
    return url.toString()
  }
  if (profile.provider === "gemini" && pathname.endsWith("/openai")) {
    url.pathname = `${pathname}/chat/completions`
    return url.toString()
  }
  return raw
}

function validateBaseUrl(value: string) {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new ModelProfileError(400, "INVALID_REQUEST", "Base URL 格式无效，需包含 http:// 或 https://")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ModelProfileError(400, "INVALID_REQUEST", "Base URL 仅支持 http:// 或 https:// 协议")
  }
}

function applyInput(base: ModelProfile, input: ModelProfileInput): ModelProfile {
  const next = { ...base }
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new ModelProfileError(400, "INVALID_REQUEST", "显示名称不能为空")
    next.name = name.slice(0, 64)
  }
  if (input.provider !== undefined) {
    if (!MODEL_PROVIDERS.some((p) => p.id === input.provider)) {
      throw new ModelProfileError(400, "INVALID_REQUEST", "provider 取值无效")
    }
    next.provider = input.provider as ModelProvider
  }
  if (input.baseUrl !== undefined) {
    const baseUrl = input.baseUrl.trim()
    if (baseUrl) validateBaseUrl(baseUrl)
    next.baseUrl = baseUrl.slice(0, 2048)
  }
  if (input.modelName !== undefined) next.modelName = input.modelName.trim().slice(0, 128)
  if (input.apiKey !== undefined) next.apiKey = input.apiKey.trim().slice(0, 512)
  if (input.enabled !== undefined) next.enabled = input.enabled
  return next
}

function persist(profiles: ModelProfile[]) {
  try {
    writeProfiles(profiles)
  } catch (error) {
    console.error("[model-profiles] 写入失败：", error)
    throw new ModelProfileError(500, "STORAGE_ERROR", "模型配置写入失败，请检查数据目录权限")
  }
  return profiles
}

export function updateProfile(id: string, input: ModelProfileInput) {
  const profiles = loadProfiles()
  const index = profiles.findIndex((p) => p.id === id)
  if (index === -1) throw new ModelProfileError(404, "NOT_FOUND", `模型档案 ${id} 不存在`)

  const updated = applyInput(profiles[index], input)
  if (profiles[index].isDefault && !updated.enabled) {
    throw new ModelProfileError(409, "DEFAULT_DISABLED", "默认模型不能被禁用，请先将其他模型设为默认")
  }
  const next = profiles.map((p, i) => (i === index ? updated : p))
  return persist(next)
}

export function createProfile(input: ModelProfileInput) {
  const profiles = loadProfiles()
  if (!input.name?.trim() || !input.baseUrl?.trim() || !input.modelName?.trim()) {
    throw new ModelProfileError(400, "INVALID_REQUEST", "名称、Base URL 与模型名称均为必填项")
  }
  const id = `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const blank: ModelProfile = {
    id,
    name: "",
    provider: "custom",
    baseUrl: "",
    apiKey: "",
    modelName: "",
    enabled: true,
    isDefault: false,
  }
  const created = applyInput(blank, input)
  return { id, profiles: persist([...profiles, created]) }
}

export function deleteProfile(id: string) {
  const profiles = loadProfiles()
  const target = profiles.find((p) => p.id === id)
  if (!target) throw new ModelProfileError(404, "NOT_FOUND", `模型档案 ${id} 不存在`)
  if (target.builtin) throw new ModelProfileError(409, "BUILTIN_PROTECTED", "内置模型不可删除，可以禁用或修改其配置")
  if (target.isDefault) throw new ModelProfileError(409, "DEFAULT_DELETE", "默认模型不能删除，请先将其他模型设为默认")
  return persist(profiles.filter((p) => p.id !== id))
}

export function setDefaultProfile(id: string) {
  const profiles = loadProfiles()
  const target = profiles.find((p) => p.id === id)
  if (!target) throw new ModelProfileError(404, "NOT_FOUND", `模型档案 ${id} 不存在`)
  if (!target.enabled) throw new ModelProfileError(409, "DISABLED", "已禁用的模型不能设为默认")
  return persist(profiles.map((p) => ({ ...p, isDefault: p.id === id })))
}
