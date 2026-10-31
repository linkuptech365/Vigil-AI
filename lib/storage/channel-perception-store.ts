import fs from "node:fs"
import path from "node:path"

import type { StoredChannelPerception } from "@/lib/vigil/channel-perception"
import { sanitizeVocabulary } from "@/lib/vigil/vision"
import { dataDir } from "./rules-store"

export function channelPerceptionPath() {
  return path.join(dataDir(), "channel-perception.json")
}

function writeAll(channels: Record<string, StoredChannelPerception>) {
  const file = channelPerceptionPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), channels }, null, 2), "utf8")
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}

/** 读取全部通道的专属初筛配置（按通道 id 索引）；文件缺失或损坏时视为尚无配置。 */
export function loadAllChannelPerception(): Record<string, StoredChannelPerception> {
  try {
    const parsed = JSON.parse(fs.readFileSync(channelPerceptionPath(), "utf8")) as { channels?: Record<string, unknown> }
    const result: Record<string, StoredChannelPerception> = {}
    for (const [channelId, raw] of Object.entries(parsed.channels ?? {})) {
      if (typeof raw !== "object" || raw === null) continue
      const item = raw as Record<string, unknown>
      result[channelId] = {
        raw_prompt: typeof item.raw_prompt === "string" ? item.raw_prompt : "",
        compiled_tags: sanitizeVocabulary(item.compiled_tags) ?? [],
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
      }
    }
    return result
  } catch {
    return {}
  }
}

export function loadChannelPerception(channelId: string): StoredChannelPerception | null {
  return loadAllChannelPerception()[channelId] ?? null
}

export function saveChannelPerception(channelId: string, value: StoredChannelPerception) {
  writeAll({ ...loadAllChannelPerception(), [channelId]: value })
}

export function deleteChannelPerception(channelId: string) {
  const all = loadAllChannelPerception()
  if (!(channelId in all)) return
  delete all[channelId]
  writeAll(all)
}
