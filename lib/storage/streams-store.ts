import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { isDemoEnabled } from "@/lib/storage/demo-store"
import { dataDir } from "@/lib/storage/rules-store"
import {
  DEMO_STREAM_ID,
  STREAM_ZONES,
  type AlertCase,
  type CaseAction,
  type EvidenceIntegrity,
  type EvidenceSeal,
  type StreamAlert,
  type StreamAnalysisRecord,
  type StreamLastAnalysis,
  type StreamMeta,
} from "@/lib/vigil/streams"

const FILE_VERSION = 1
const MAX_RECORDS = 500
const DEFAULT_RETENTION_DAYS = 365
const ERROR_DEDUPE_MS = 10 * 60_000
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

function recordsFilePath() {
  return path.join(dataDir(), "stream-records.json")
}

export function evidenceDir(alertId: string) {
  return path.join(dataDir(), "stream-evidence", alertId)
}

const ALERT_ID_PATTERN = /^[a-z0-9-]{6,64}$/i

function sha256(buffer: Buffer | string) {
  return createHash("sha256").update(buffer).digest("hex")
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

/** 研判事实部分的哈希：不含处置过程与封存信息，处置动作不会使它失效。 */
export function alertRecordHash(alert: StreamAlert) {
  const { case: _case, seal: _seal, vlm: _vlm, ...facts } = alert
  return sha256(stableStringify(facts))
}

export function evidenceRetentionDays() {
  const parsed = Number(process.env.VIGIL_EVIDENCE_RETENTION_DAYS)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_RETENTION_DAYS
}

export function loadAlerts(): StreamAlert[] {
  const parsed = readJson(alertsFilePath()) as { alerts?: unknown } | null
  return Array.isArray(parsed?.alerts) ? (parsed.alerts as StreamAlert[]) : []
}

function writeAlerts(alerts: StreamAlert[]) {
  atomicWriteJson(alertsFilePath(), { version: FILE_VERSION, alerts })
}

export function getAlert(alertId: string) {
  return loadAlerts().find((alert) => alert.id === alertId) ?? null
}

function caseSequence(all: StreamAlert[], at: Date) {
  const day = at.toISOString().slice(0, 10).replace(/-/g, "")
  const todays = all.filter((a) => a.case?.caseId.startsWith(`CASE-${day}-`)).length
  return `CASE-${day}-${String(todays + 1).padStart(3, "0")}`
}

function systemAction(notes: string, actionType: string, at: string): CaseAction {
  return { id: `ACT-${randomUUID().slice(0, 8)}`, at, operator: "Vigil-AI 系统", actionType, notes }
}

/**
 * 告警落库：写入关键帧 -> 逐文件计算 SHA-256 -> 写封存清单 -> 自动建案 -> 追加到告警列表。
 * 封存之后文件内容任何变化，都能被 verifyEvidence 发现。
 */
export function saveAlert(alert: StreamAlert, frames: Buffer[]) {
  const dir = evidenceDir(alert.id)
  fs.mkdirSync(dir, { recursive: true })
  const files = frames.map((buffer, index) => {
    const name = `${index + 1}.jpg`
    fs.writeFileSync(path.join(dir, name), buffer)
    return { name, sha256: sha256(buffer), bytes: buffer.length }
  })

  const sealedAt = new Date().toISOString()
  const seal: EvidenceSeal = { algorithm: "SHA-256", sealedAt, recordHash: alertRecordHash(alert), files }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ format: "vigil-evidence/1", alertId: alert.id, ...seal }, null, 2), "utf8")

  const existing = loadAlerts()
  const created: AlertCase = {
    caseId: caseSequence(existing, new Date(alert.triggeredAt)),
    status: "PENDING",
    actions: [
      systemAction(
        `规则「${alert.ruleName}」命中（${alert.severity}，置信度 ${alert.confidence}%），已自动建案并封存 ${files.length} 帧证据。`,
        "自动建案",
        sealedAt
      ),
    ],
    linkage: [],
  }
  writeAlerts([{ ...alert, seal, case: created }, ...existing])
  purgeExpiredEvidence()
  return created
}

/** 读-改-写一条告警；回调返回 null 表示不修改。 */
export function updateAlert(alertId: string, mutate: (alert: StreamAlert) => StreamAlert | null) {
  const all = loadAlerts()
  const index = all.findIndex((alert) => alert.id === alertId)
  if (index < 0) return null
  const next = mutate(all[index])
  if (!next) return all[index]
  all[index] = next
  writeAlerts(all)
  return next
}

export function appendCaseAction(alertId: string, action: Omit<CaseAction, "id" | "at"> & { at?: string }, patch?: Partial<AlertCase>) {
  return updateAlert(alertId, (alert) => {
    if (!alert.case) return null
    const at = action.at ?? new Date().toISOString()
    return {
      ...alert,
      case: {
        ...alert.case,
        ...patch,
        actions: [{ id: `ACT-${randomUUID().slice(0, 8)}`, at, operator: action.operator, actionType: action.actionType, notes: action.notes }, ...alert.case.actions],
      },
    }
  })
}

export function readEvidenceFrame(alertId: string, index: number): Buffer | null {
  if (!ALERT_ID_PATTERN.test(alertId) || !Number.isInteger(index) || index < 1 || index > 16) return null
  try {
    return fs.readFileSync(path.join(evidenceDir(alertId), `${index}.jpg`))
  } catch {
    return null
  }
}

/** 重新计算磁盘上证据文件与研判记录的哈希，与封存时的清单比对。 */
export function verifyEvidence(alert: StreamAlert): EvidenceIntegrity {
  const checkedAt = new Date().toISOString()
  if (!alert.seal || !ALERT_ID_PATTERN.test(alert.id)) {
    return { ok: false, checkedAt, missing: [], tampered: [], recordMatches: false }
  }
  const missing: string[] = []
  const tampered: string[] = []
  for (const file of alert.seal.files) {
    try {
      const buffer = fs.readFileSync(path.join(evidenceDir(alert.id), file.name))
      if (sha256(buffer) !== file.sha256) tampered.push(file.name)
    } catch {
      missing.push(file.name)
    }
  }
  const recordMatches = alertRecordHash(alert) === alert.seal.recordHash
  return { ok: missing.length === 0 && tampered.length === 0 && recordMatches, checkedAt, missing, tampered, recordMatches }
}

/**
 * 只清理“已结案或误报且超过保留期”的告警；未处置或处置中的告警永不自动删除。
 * 保留期默认 365 天，可用 VIGIL_EVIDENCE_RETENTION_DAYS 调整。
 */
export function purgeExpiredEvidence(now = Date.now()) {
  const cutoff = now - evidenceRetentionDays() * 86_400_000
  const all = loadAlerts()
  const expired = all.filter((alert) => {
    const status = alert.case?.status
    if (status !== "RESOLVED" && status !== "FALSE_POSITIVE") return false
    const closed = new Date(alert.case?.closedAt ?? alert.triggeredAt).getTime()
    return Number.isFinite(closed) && closed < cutoff
  })
  if (expired.length === 0) return 0
  const drop = new Set(expired.map((alert) => alert.id))
  for (const alert of expired) fs.rmSync(evidenceDir(alert.id), { recursive: true, force: true })
  writeAlerts(all.filter((alert) => !drop.has(alert.id)))
  return expired.length
}

export function removeAlertsOfStream(streamId: string) {
  const all = loadAlerts()
  const kept = all.filter((alert) => alert.streamId !== streamId)
  if (kept.length === all.length) return
  for (const alert of all) if (alert.streamId === streamId) fs.rmSync(evidenceDir(alert.id), { recursive: true, force: true })
  writeAlerts(kept)
}

/* -------------------------------- 研判记录 -------------------------------- */

export function loadRecords(): StreamAnalysisRecord[] {
  const parsed = readJson(recordsFilePath()) as { records?: unknown } | null
  return Array.isArray(parsed?.records) ? (parsed.records as StreamAnalysisRecord[]) : []
}

/** 追加一条研判记录；同一通道在 10 分钟内重复出现同一失败原因时合并计数，避免定时巡检刷屏。 */
export function appendRecord(record: Omit<StreamAnalysisRecord, "id">) {
  const all = loadRecords()
  const last = all.find((item) => item.streamId === record.streamId)
  const at = new Date(record.at).getTime()
  if (
    record.outcome === "error" &&
    last?.outcome === "error" &&
    last.reason === record.reason &&
    at - new Date(last.at).getTime() < ERROR_DEDUPE_MS
  ) {
    last.at = record.at
    last.count = (last.count ?? 1) + 1
    atomicWriteJson(recordsFilePath(), { version: FILE_VERSION, records: all })
    return last
  }
  const created: StreamAnalysisRecord = { ...record, id: randomUUID() }
  atomicWriteJson(recordsFilePath(), { version: FILE_VERSION, records: [created, ...all].slice(0, MAX_RECORDS) })
  return created
}

export function removeRecordsOfStream(streamId: string) {
  const all = loadRecords()
  const kept = all.filter((item) => item.streamId !== streamId)
  if (kept.length !== all.length) atomicWriteJson(recordsFilePath(), { version: FILE_VERSION, records: kept })
}
