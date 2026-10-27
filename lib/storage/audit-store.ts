import fs from "node:fs"
import path from "node:path"

import { MAX_ALARM_RECORDS, type AuditRecord } from "@/lib/vigil/audit"
import { loadVisionConfig } from "./vision-store"
import { dataDir } from "./rules-store"

interface AuditState {
  records: AuditRecord[]
  loaded: boolean
  timer: ReturnType<typeof setTimeout> | null
}

const globalState = globalThis as unknown as { __vigilAudit?: AuditState }
const state: AuditState = (globalState.__vigilAudit ??= { records: [], loaded: false, timer: null })

export function auditLogPath() {
  return path.join(dataDir(), "audit-log.json")
}

function ensureLoaded() {
  if (state.loaded) return
  state.loaded = true
  try {
    const parsed = JSON.parse(fs.readFileSync(auditLogPath(), "utf8")) as { records?: AuditRecord[] }
    if (Array.isArray(parsed.records)) state.records = parsed.records
  } catch {
    state.records = []
  }
}

function persistNow() {
  state.timer = null
  const file = auditLogPath()
  const temp = `${file}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), records: state.records }), "utf8")
    fs.renameSync(temp, file)
  } catch {
    fs.rmSync(temp, { force: true })
  }
}

/** 合并写盘：高频帧级审计只在 1.5 秒静默后落盘一次。 */
function schedulePersist() {
  if (state.timer) return
  state.timer = setTimeout(persistNow, 1500)
}

function prune(retention: number) {
  const alarms: AuditRecord[] = []
  const rest: AuditRecord[] = []
  for (const record of state.records) (record.alarm ? alarms : rest).push(record)
  const keep = new Set<AuditRecord>([...alarms.slice(0, MAX_ALARM_RECORDS), ...rest.slice(0, retention)])
  state.records = state.records.filter((record) => keep.has(record))
}

function byTimeDesc(a: AuditRecord, b: AuditRecord) {
  return a.at < b.at ? 1 : a.at > b.at ? -1 : 0
}

/** 按 id 幂等写入：同一 id 视为对既有记录的更新（如一级初筛的重复帧计数）。 */
export function upsertAuditRecords(incoming: AuditRecord[]) {
  if (!incoming.length) return
  ensureLoaded()
  const index = new Map(state.records.map((record, position) => [record.id, position]))
  for (const record of incoming) {
    const position = index.get(record.id)
    if (position === undefined) {
      state.records.push(record)
      index.set(record.id, state.records.length - 1)
    } else {
      state.records[position] = record
    }
  }
  state.records.sort(byTimeDesc)
  prune(loadVisionConfig().auditRetention)
  schedulePersist()
}

export interface AuditQuery {
  kind?: "tier1" | "tier2"
  streamId?: string
  ruleId?: string
  alarm?: boolean
  limit: number
}

export function queryAuditRecords(query: AuditQuery) {
  ensureLoaded()
  const all = state.records
  const filtered = all.filter((record) => {
    if (query.kind && record.kind !== query.kind) return false
    if (query.streamId && record.streamId !== query.streamId) return false
    if (query.alarm !== undefined && record.alarm !== query.alarm) return false
    if (query.ruleId) {
      if (record.kind === "tier2") return record.ruleId === query.ruleId
      return record.decisions.some((decision) => decision.ruleId === query.ruleId)
    }
    return true
  })
  return {
    records: filtered.slice(0, query.limit),
    counts: {
      tier1: all.filter((r) => r.kind === "tier1").length,
      tier2: all.filter((r) => r.kind === "tier2").length,
      alarm: all.filter((r) => r.alarm).length,
      nonAlarm: all.filter((r) => !r.alarm).length,
    },
  }
}

export function clearAuditRecords() {
  ensureLoaded()
  state.records = []
  persistNow()
}
