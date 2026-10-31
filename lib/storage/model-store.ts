import fs from "node:fs"
import path from "node:path"

import { BUILTIN_PROFILES, type ModelProfile, type ModelProvider } from "@/lib/vigil/model-registry"
import { dataDir } from "./rules-store"

const FILE_VERSION = 1
const PROVIDERS: ModelProvider[] = ["openai", "qwen", "gemini", "ollama", "custom"]

interface ModelsFile {
  version: number
  updatedAt: string
  profiles: ModelProfile[]
}

export function modelsFilePath() {
  return path.join(dataDir(), "models.json")
}

function seedProfiles(): ModelProfile[] {
  return BUILTIN_PROFILES.map((profile) => ({ ...profile }))
}

function isProfile(value: unknown): value is ModelProfile {
  if (typeof value !== "object" || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    PROVIDERS.includes(p.provider as ModelProvider) &&
    typeof p.baseUrl === "string" &&
    typeof p.apiKey === "string" &&
    typeof p.modelName === "string" &&
    typeof p.enabled === "boolean" &&
    typeof p.isDefault === "boolean"
  )
}

/** 保证有且仅有一个默认档案，且默认档案处于启用状态。 */
function normalizeDefault(profiles: ModelProfile[]): ModelProfile[] {
  const current = profiles.find((p) => p.isDefault && p.enabled)
  const fallback = current ?? profiles.find((p) => p.enabled) ?? profiles[0]
  return profiles.map((p) => ({ ...p, isDefault: p.id === fallback?.id }))
}

/** 内置档案被意外删除（或旧文件缺失）时补回，保证内置模型始终可选。 */
function ensureBuiltins(profiles: ModelProfile[]): ModelProfile[] {
  const ids = new Set(profiles.map((p) => p.id))
  const missing = BUILTIN_PROFILES.filter((b) => !ids.has(b.id)).map((b) => ({ ...b, isDefault: false }))
  return [...profiles, ...missing]
}

/**
 * 原子写（临时文件 + fsync + rename）。文件含 API Key，权限收紧为仅属主可读写。
 */
export function writeProfiles(profiles: ModelProfile[]) {
  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true })

  const payload: ModelsFile = { version: FILE_VERSION, updatedAt: new Date().toISOString(), profiles }
  const target = modelsFilePath()
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`

  let fd: number | undefined
  try {
    fd = fs.openSync(temp, "w", 0o600)
    fs.writeFileSync(fd, JSON.stringify(payload, null, 2), "utf8")
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(temp, target)
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd)
    fs.rmSync(temp, { force: true })
    throw error
  }
}

export function loadProfiles(): ModelProfile[] {
  const file = modelsFilePath()

  if (!fs.existsSync(file)) {
    const seed = seedProfiles()
    try {
      writeProfiles(seed)
    } catch (error) {
      console.error(`[model-store] 无法在 ${file} 写入内置模型，本次仅使用内存配置：`, error)
    }
    return seed
  }

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
    const list = Array.isArray(parsed) ? parsed : (parsed as Partial<ModelsFile> | null)?.profiles
    if (!Array.isArray(list)) throw new Error("profiles 字段不是数组")
    const valid = list.filter(isProfile).map((p) => ({ ...p }))
    return normalizeDefault(ensureBuiltins(valid))
  } catch (error) {
    console.error("[model-store] 读取模型配置失败，已备份并重建：", error)
    try {
      fs.copyFileSync(file, `${file}.broken-${Date.now()}`)
    } catch {
      // 备份失败不阻塞服务启动
    }
    const seed = seedProfiles()
    try {
      writeProfiles(seed)
    } catch (writeError) {
      console.error("[model-store] 重建模型配置失败：", writeError)
    }
    return seed
  }
}
