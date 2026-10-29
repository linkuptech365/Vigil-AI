import fs from "node:fs"
import path from "node:path"

import { INITIAL_INSPECTION_RULES } from "@/lib/ops/rules-data"
import type { InspectionRule, InspectionRuleType } from "@/lib/ops/rules-types"

const FILE_VERSION = 1
const RULE_TYPES: InspectionRuleType[] = ["GEOMETRIC", "THRESHOLD", "PROMPT_SEMANTIC"]

interface RulesFile {
  version: number
  updatedAt: string
  rules: InspectionRule[]
}

/** 数据目录：VIGIL_DATA_DIR 优先；Docker 内 cwd 为 /app，默认即 /app/data。 */
export function dataDir() {
  const configured = process.env.VIGIL_DATA_DIR?.trim()
  return path.resolve(configured || path.join(process.cwd(), "data"))
}

export function rulesFilePath() {
  return path.join(dataDir(), "rules.json")
}

function cloneRule(rule: InspectionRule): InspectionRule {
  return {
    ...rule,
    boundChannels: [...rule.boundChannels],
    actions: rule.actions ? { ...rule.actions } : undefined,
  }
}

export function seedRules(): InspectionRule[] {
  return INITIAL_INSPECTION_RULES.map(cloneRule)
}

function isRule(value: unknown): value is InspectionRule {
  if (typeof value !== "object" || value === null) return false
  const rule = value as Record<string, unknown>
  return (
    typeof rule.id === "string" &&
    typeof rule.name === "string" &&
    RULE_TYPES.includes(rule.type as InspectionRuleType) &&
    Array.isArray(rule.boundChannels) &&
    typeof rule.severity === "string" &&
    typeof rule.cooldownSeconds === "number" &&
    typeof rule.schedule === "string" &&
    typeof rule.enabled === "boolean"
  )
}

/**
 * 原子写：先写同目录临时文件并 fsync，再 rename 覆盖。
 * rename 在同一文件系统内是原子的，读取方永远只会看到完整的旧文件或完整的新文件。
 * 全部使用同步 IO，单进程内的写入天然串行，不会出现交错写坏 JSON。
 */
export function writeRules(rules: InspectionRule[]) {
  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true })

  const payload: RulesFile = { version: FILE_VERSION, updatedAt: new Date().toISOString(), rules }
  const target = rulesFilePath()
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`

  let fd: number | undefined
  try {
    fd = fs.openSync(temp, "w")
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

function migrationsFilePath() {
  return path.join(dataDir(), "rules-migrations.json")
}

/** 一次性数据迁移的完成标记，保证迁移只跑一次，之后用户手动改的绑定不会被重启覆盖。 */
export function hasMigration(id: string) {
  try {
    const parsed = JSON.parse(fs.readFileSync(migrationsFilePath(), "utf8")) as { done?: unknown }
    return Array.isArray(parsed.done) && parsed.done.includes(id)
  } catch {
    return false
  }
}

export function markMigration(id: string) {
  let done: string[] = []
  try {
    const parsed = JSON.parse(fs.readFileSync(migrationsFilePath(), "utf8")) as { done?: unknown }
    if (Array.isArray(parsed.done)) done = parsed.done.filter((item): item is string => typeof item === "string")
  } catch {
    done = []
  }
  if (done.includes(id)) return
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.writeFileSync(migrationsFilePath(), JSON.stringify({ done: [...done, id] }, null, 2), "utf8")
}

function backupBroken(file: string) {
  const backup = `${file}.broken-${Date.now()}`
  try {
    fs.copyFileSync(file, backup)
    console.error(`[rules-store] ${file} 无法解析，已备份到 ${backup} 并重新写入内置规则`)
  } catch (error) {
    console.error("[rules-store] 备份损坏的规则文件失败：", error)
  }
}

/**
 * 读取规则库。文件不存在时写入内置规则作为种子；文件存在时只读取，绝不覆盖用户数据。
 * 文件损坏时先备份再重建，保证服务能起来且原始内容仍可人工恢复。
 */
export function loadRules(firstRunSeed: InspectionRule[] = []): InspectionRule[] {
  const file = rulesFilePath()

  if (!fs.existsSync(file)) {
    const seed = firstRunSeed.map(cloneRule)
    try {
      writeRules(seed)
    } catch (error) {
      console.error(`[rules-store] 无法在 ${file} 写入种子规则，本次仅使用内存规则：`, error)
    }
    return seed
  }

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
    const list = Array.isArray(parsed) ? parsed : (parsed as Partial<RulesFile> | null)?.rules
    if (!Array.isArray(list)) throw new Error("rules 字段不是数组")

    const valid = list.filter(isRule).map(cloneRule)
    if (valid.length !== list.length) {
      console.error(`[rules-store] ${list.length - valid.length} 条规则格式不合法，已在内存中忽略`)
    }
    return valid
  } catch (error) {
    console.error("[rules-store] 读取规则文件失败：", error)
    backupBroken(file)
    const seed = firstRunSeed.map(cloneRule)
    try {
      writeRules(seed)
    } catch (writeError) {
      console.error("[rules-store] 重建规则文件失败：", writeError)
    }
    return seed
  }
}
