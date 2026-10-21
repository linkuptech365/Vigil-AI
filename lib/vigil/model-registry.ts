export type ModelProvider = "openai" | "qwen" | "gemini" | "ollama" | "custom"

export const MODEL_PROVIDERS: { id: ModelProvider; label: string }[] = [
  { id: "openai", label: "OpenAI 兼容" },
  { id: "qwen", label: "通义千问 (DashScope)" },
  { id: "gemini", label: "Google Gemini" },
  { id: "ollama", label: "Ollama 本地" },
  { id: "custom", label: "自定义网关" },
]

/** 服务端持有的完整模型档案；apiKey 只存在于服务端，永远不会回传浏览器。 */
export interface ModelProfile {
  id: string
  name: string
  provider: ModelProvider
  baseUrl: string
  apiKey: string
  modelName: string
  enabled: boolean
  isDefault: boolean
  /** 内置档案不可删除，只能禁用或编辑 */
  builtin?: boolean
}

/** 浏览器看到的档案：Key 被替换为「是否已配置」和脱敏提示。 */
export interface PublicModelProfile extends Omit<ModelProfile, "apiKey"> {
  hasKey: boolean
  keyHint: string
}

export interface ModelsListResponse {
  profiles: PublicModelProfile[]
}

export interface ModelProfileInput {
  name?: string
  provider?: ModelProvider
  baseUrl?: string
  /** 省略 = 保持不变；空字符串 = 清除 */
  apiKey?: string
  modelName?: string
  enabled?: boolean
}

export const BUILTIN_PROFILES: ModelProfile[] = [
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra (专网)",
    provider: "openai",
    baseUrl: "http://20.49.0.69:3000/v1",
    apiKey: "",
    modelName: "gpt-6-astra-2026-09-03",
    enabled: true,
    isDefault: true,
    builtin: true,
  },
  {
    id: "qwen-2.5-vl",
    name: "Qwen2.5-VL (通义千问)",
    provider: "qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    modelName: "qwen2.5-vl-72b-instruct",
    enabled: true,
    isDefault: false,
    builtin: true,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    modelName: "gpt-4o-mini",
    enabled: true,
    isDefault: false,
    builtin: true,
  },
  {
    id: "ollama-local",
    name: "Ollama 本地实例",
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    apiKey: "",
    modelName: "qwen2.5vl:7b",
    enabled: true,
    isDefault: false,
    builtin: true,
  },
]

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/

/** 本地/内网端点允许无 Key 调用（与推理引擎的判定保持一致）。 */
export function isLocalBaseUrl(baseUrl: string) {
  try {
    const { hostname } = new URL(baseUrl.trim())
    return PRIVATE_HOST.test(hostname) || hostname.endsWith(".local")
  } catch {
    return false
  }
}

export interface Readiness {
  ready: boolean
  /** 未就绪时给用户看的原因 */
  reason?: string
}

export function profileReadiness(profile: {
  provider: ModelProvider
  baseUrl: string
  modelName: string
  enabled: boolean
  hasKey: boolean
}): Readiness {
  if (!profile.enabled) return { ready: false, reason: "已禁用" }
  if (!profile.baseUrl.trim()) return { ready: false, reason: "未填写 Base URL" }
  if (!profile.modelName.trim()) return { ready: false, reason: "未填写模型名称" }
  if (!profile.hasKey && profile.provider !== "ollama" && !isLocalBaseUrl(profile.baseUrl)) {
    return { ready: false, reason: "未配置 API Key" }
  }
  return { ready: true }
}

export function maskKey(key: string) {
  if (!key) return ""
  if (key.length <= 8) return "••••••••"
  return `${key.slice(0, 3)}••••••••${key.slice(-4)}`
}
