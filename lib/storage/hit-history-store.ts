import fs from "node:fs"
import path from "node:path"

import {
  hitStatusOf,
  type HitHistoryRecord,
  type HitHistoryResponse,
  type HitHistoryStatus,
} from "@/lib/vigil/hit-history"
import { loadVisionConfig } from "./vision-store"
import { dataDir } from "./rules-store"

interface HitState {
  records: HitHistoryRecord[]
  loaded: boolean
  timer: ReturnType<typeof setTimeout> | null
}

const globalState = globalThis as unknown as { __vigilHitHistory?: HitState }
const state: HitState = (globalState.__vigilHitHistory ??= { records: [], loaded: false, timer: null })

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export function hitRecordsPath() {
  return path.join(dataDir(), "audit", "hit-records.json")
}

export function hitFramesDir() {
  return path.join(dataDir(), "audit", "hit-frames")
}

function framePath(id: string) {
  return path.join(hitFramesDir(), `${id}.jpg`)
}

function removeFrame(id: string) {
  if (!SAFE_ID.test(id)) return
  fs.rmSync(framePath(id), { force: true })
}

function ensureLoaded() {
  if (state.loaded) return
  state.loaded = true
  try {
    const parsed = JSON.parse(fs.readFileSync(hitRecordsPath(), "utf8")) as { records?: HitHistoryRecord[] }
    if (Array.isArray(parsed.records)) state.records = parsed.records
  } catch {
    state.records = []
  }
}

function persistNow() {
  state.timer = null
  const file = hitRecordsPath()
  const temp = `${file}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), records: state.records }), "utf8")
    fs.renameSync(temp, file)
  } catch {
    fs.rmSync(temp, { force: true })
  }
}

function schedulePersist() {
  if (state.timer) return
  state.timer = setTimeout(persistNow, 1500)
}

function byTimeDesc(a: HitHistoryRecord, b: HitHistoryRecord) {
  return a.at < b.at ? 1 : a.at > b.at ? -1 : 0
}

/** FIFO：超过上限时淘汰最旧的记录，同时删除它们关联的帧文件。返回是否发生了淘汰。 */
function enforceCapacity(): boolean {
  const capacity = loadVisionConfig().auditRetention
  if (state.records.length <= capacity) return false
  state.records.sort(byTimeDesc)
  const evicted = state.records.splice(capacity)
  for (const record of evicted) removeFrame(record.id)
  return true
}

export interface HitIngestItem {
  record: HitHistoryRecord
  /** 触发帧 JPEG；缺省表示该条是对既有记录的更新或帧编码失败 */
  frame?: Buffer
}

export interface HitUpdateItem {
  id: string
  repeat: number
  lastAt: string
}

export function ingestHitRecords(items: HitIngestItem[], updates: HitUpdateItem[]) {
  if (!items.length && !updates.length) return
  ensureLoaded()
  const index = new Map(state.records.map((record) => [record.id, record]))
  for (const { record, frame } of items) {
    let hasFrame = false
    if (frame && SAFE_ID.test(record.id)) {
      try {
        fs.mkdirSync(hitFramesDir(), { recursive: true })
        fs.writeFileSync(framePath(record.id), frame)
        hasFrame = true
      } catch {
        hasFrame = false
      }
    }
    const existing = index.get(record.id)
    const next: HitHistoryRecord = { ...record, hasFrame: hasFrame || existing?.hasFrame === true }
    if (existing) Object.assign(existing, next)
    else {
      state.records.push(next)
      index.set(next.id, next)
    }
  }
  for (const update of updates) {
    const target = index.get(update.id)
    if (!target) continue
    target.repeat = Math.max(target.repeat, update.repeat)
    target.lastAt = update.lastAt
  }
  state.records.sort(byTimeDesc)
  enforceCapacity()
  schedulePersist()
}

export interface HitHistoryQuery {
  streamId?: string
  status?: HitHistoryStatus
  limit: number
  offset: number
}

export function queryHitRecords(query: HitHistoryQuery): HitHistoryResponse {
  ensureLoaded()
  if (enforceCapacity()) schedulePersist()
  const all = state.records
  const inStream = query.streamId ? all.filter((record) => record.streamId === query.streamId) : all
  const matched = query.status ? inStream.filter((record) => hitStatusOf(record) === query.status) : inStream
  const counts: Record<HitHistoryStatus, number> = { alarm: 0, blocked: 0, passed: 0 }
  for (const record of inStream) counts[hitStatusOf(record)] += 1
  return {
    status: "ok",
    retention: loadVisionConfig().auditRetention,
    total: all.length,
    matched: matched.length,
    counts,
    offset: query.offset,
    limit: query.limit,
    records: matched.slice(query.offset, query.offset + query.limit),
  }
}

export function readHitFrame(id: string): Buffer | null {
  if (!SAFE_ID.test(id)) return null
  try {
    return fs.readFileSync(framePath(id))
  } catch {
    return null
  }
}

export function clearHitRecords() {
  ensureLoaded()
  state.records = []
  if (state.timer) clearTimeout(state.timer)
  persistNow()
  fs.rmSync(hitFramesDir(), { recursive: true, force: true })
}
