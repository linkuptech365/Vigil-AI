import fs from "node:fs"
import path from "node:path"

import type { Tier1Learning } from "@/lib/vigil/tier1-learning"
import { dataDir } from "./rules-store"

export function tier1LearningPath() {
  return path.join(dataDir(), "tier1-learning.json")
}

/** 读取全部通道的自优化状态（按通道 id 索引）；文件缺失或损坏时视为尚无学习内容。 */
export function loadAllLearning(): Record<string, Tier1Learning> {
  try {
    const parsed = JSON.parse(fs.readFileSync(tier1LearningPath(), "utf8")) as { streams?: Record<string, Tier1Learning> }
    return parsed.streams && typeof parsed.streams === "object" ? parsed.streams : {}
  } catch {
    return {}
  }
}

export function loadLearning(streamId: string): Tier1Learning | null {
  return loadAllLearning()[streamId] ?? null
}

/** 原子写：临时文件 + rename。 */
export function saveLearning(learning: Tier1Learning) {
  const all = loadAllLearning()
  all[learning.streamId] = learning
  const file = tier1LearningPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), streams: all }, null, 2), "utf8")
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}
