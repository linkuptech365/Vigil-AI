import fs from "node:fs"
import path from "node:path"

import { dataDir } from "./rules-store"

function demoModePath() {
  return path.join(dataDir(), "demo-mode.json")
}

/** 演示数据开关：默认关闭，只有用户在设置里主动开启才会展示任何模拟数据。 */
export function isDemoEnabled(): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(demoModePath(), "utf8")) as { enabled?: unknown }
    return parsed.enabled === true
  } catch {
    return false
  }
}

export function setDemoEnabled(enabled: boolean) {
  const file = demoModePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), enabled }, null, 2), "utf8")
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}
