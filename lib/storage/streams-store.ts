import fs from "node:fs"
import path from "node:path"

import { isDemoEnabled } from "@/lib/storage/demo-store"
import { dataDir } from "@/lib/storage/rules-store"
import {
  DEMO_STREAM_ID,
  STREAM_ZONES,
  type StreamAlert,
  type StreamLastAnalysis,
  type StreamMeta,
} from "@/lib/vigil/streams"

const FILE_VERSION = 1
const MAX_ALERTS = 200
const DEMO_VIDEO_NAME = "37165810902.mp4"

function atomicWriteJson(file: string, payload: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), "utf8")
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

/** 查找用于模拟 7x24 实时流的测试视频：优先 37165810902.mp4，其次项目自带的示例录像。 */
export function findDemoVideo(): string | null {
  const cwd = process.cwd()
  const explicit = process.env.VIGIL_DEMO_VIDEO?.trim()
  const named = [
    explicit,
    path.join(cwd, "vidso", DEMO_VIDEO_NAME),
    path.join(cwd, "public", DEMO_VIDEO_NAME),
    path.join(cwd, "public", "ops", "video", DEMO_VIDEO_NAME),
    path.join(dataDir(), DEMO_VIDEO_NAME),
  ].filter((item): item is string => Boolean(item))
  for (const candidate of named) if (fs.existsSync(candidate)) return candidate

  const sampleDir = path.join(cwd, "public", "ops", "video")
  try {
    const sample = fs.readdirSync(sampleDir).filter((file) => file.toLowerCase().endsWith(".mp4")).sort()[0]
    return sample ? path.join(sampleDir, sample) : null
  } catch {
    return null
  }
}

export function streamsFilePath() {
  return path.join(dataDir(), "streams.json")
}

function isStreamMeta(value: unknown): value is StreamMeta {
  if (typeof value !== "object" || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.id === "string" && typeof item.name === "string" && typeof item.source === "string"
}

function seedStreams(): StreamMeta[] {
  if (!findDemoVideo()) return []
  return [
    {
      id: DEMO_STREAM_ID,
      name: "B 级洁净区灌装间-模拟循环流",
      zone: STREAM_ZONES[1],
      source: "",
      builtin: true,
      autoPatrol: false,
      createdAt: new Date().toISOString(),
    },
  ]
}

export function loadStreams(): StreamMeta[] {
  const file = streamsFilePath()
  const demo = isDemoEnabled()
  let list: StreamMeta[]
  if (!fs.existsSync(file)) {
    list = []
  } else {
    const parsed = readJson(file) as { streams?: unknown } | null
    const raw = Array.isArray(parsed?.streams) ? parsed.streams : []
    list = raw.filter(isStreamMeta).map((item) => ({
      ...item,
      zone: item.zone || STREAM_ZONES[5],
      builtin: item.builtin === true,
      autoPatrol: item.autoPatrol === true,
    }))
  }
  if (!demo) return list.filter((item) => !item.builtin)
  if (!list.some((item) => item.builtin)) return [...seedStreams(), ...list]
  return list
}

export function writeStreams(streams: StreamMeta[]) {
  atomicWriteJson(streamsFilePath(), { version: FILE_VERSION, updatedAt: new Date().toISOString(), streams })
}

export function getStream(id: string) {
  return loadStreams().find((stream) => stream.id === id) ?? null
}

export function patchStream(id: string, patch: Partial<Pick<StreamMeta, "autoPatrol" | "lastAnalysis" | "name" | "zone">>) {
  const streams = loadStreams()
  const index = streams.findIndex((stream) => stream.id === id)
  if (index < 0) return null
  streams[index] = { ...streams[index], ...patch }
  writeStreams(streams)
  return streams[index]
}

export function recordAnalysis(id: string, analysis: StreamLastAnalysis) {
  return patchStream(id, { lastAnalysis: analysis })
}

/* ---------------------------------- 告警 ---------------------------------- */

function alertsFilePath() {
  return path.join(dataDir(), "stream-alerts.json")
}

export function evidenceDir(alertId: string) {
  return path.join(dataDir(), "stream-evidence", alertId)
}

export function loadAlerts(): StreamAlert[] {
  const parsed = readJson(alertsFilePath()) as { alerts?: unknown } | null
  return Array.isArray(parsed?.alerts) ? (parsed.alerts as StreamAlert[]) : []
}

export function saveAlert(alert: StreamAlert, frames: Buffer[]) {
  const dir = evidenceDir(alert.id)
  fs.mkdirSync(dir, { recursive: true })
  frames.forEach((buffer, index) => fs.writeFileSync(path.join(dir, `${index + 1}.jpg`), buffer))

  const all = [alert, ...loadAlerts()]
  const kept = all.slice(0, MAX_ALERTS)
  for (const dropped of all.slice(MAX_ALERTS)) fs.rmSync(evidenceDir(dropped.id), { recursive: true, force: true })
  atomicWriteJson(alertsFilePath(), { version: FILE_VERSION, alerts: kept })
}

export function readEvidenceFrame(alertId: string, index: number): Buffer | null {
  if (!/^[a-z0-9-]{6,64}$/i.test(alertId) || !Number.isInteger(index) || index < 1 || index > 16) return null
  try {
    return fs.readFileSync(path.join(evidenceDir(alertId), `${index}.jpg`))
  } catch {
    return null
  }
}

export function removeAlertsOfStream(streamId: string) {
  const all = loadAlerts()
  const kept = all.filter((alert) => alert.streamId !== streamId)
  if (kept.length === all.length) return
  for (const alert of all) if (alert.streamId === streamId) fs.rmSync(evidenceDir(alert.id), { recursive: true, force: true })
  atomicWriteJson(alertsFilePath(), { version: FILE_VERSION, alerts: kept })
}
