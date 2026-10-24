import fs from "node:fs"
import path from "node:path"

import { DEFAULT_VISION_CONFIG, sanitizeVisionConfig, type VisionConfig } from "@/lib/vigil/vision"
import { dataDir } from "./rules-store"

export function visionConfigPath() {
  return path.join(dataDir(), "vision-config.json")
}

export function loadVisionConfig(): VisionConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(visionConfigPath(), "utf8")) as { config?: unknown }
    return sanitizeVisionConfig(parsed.config, DEFAULT_VISION_CONFIG)
  } catch {
    return { ...DEFAULT_VISION_CONFIG, vocabulary: DEFAULT_VISION_CONFIG.vocabulary.map((item) => ({ ...item })) }
  }
}

/** 原子写：临时文件 + rename，避免热更新途中读到半截 JSON。 */
export function saveVisionConfig(config: VisionConfig) {
  const file = visionConfigPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), config }, null, 2), "utf8")
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}
