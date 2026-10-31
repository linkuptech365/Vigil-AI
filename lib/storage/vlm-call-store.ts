import "server-only"

import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { getStream } from "@/lib/storage/streams-store"
import { dataDir } from "@/lib/storage/rules-store"
import {
  VLM_CALL_TRIGGERS,
  type VlmCallDetail,
  type VlmCallLogsResponse,
  type VlmCallRecord,
  type VlmCallRuleSnapshot,
  type VlmCallStats,
  type VlmCallStatus,
  type VlmCallTrigger,
} from "@/lib/vigil/vlm-call-log"

/** 流水保留上限（FIFO）：每条含提示词与模型原文，上限用来约束 JSON 体积与磁盘占用。 */
export const VLM_CALL_CAPACITY = 500

const MAX_SAVED_FRAMES = 3
const MAX_FRAME_BYTES = 800_000
const MAX_PROMPT_CHARS = 6_000
const MAX_OUTPUT_CHARS = 10_000
const FRAME_MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }

function auditDir() {
  return path.join(dataDir(), "audit")
}

function framesDir() {
  return path.join(auditDir(), "vlm-call-frames")
}

function filePath() {
  return path.join(auditDir(), "vlm-calls.json")
}

interface StoreState {
  records: VlmCallDetail[] | null
}

const globalState = globalThis as unknown as { __vigilVlmCalls?: StoreState }

function state(): StoreState {
  if (!globalState.__vigilVlmCalls) globalState.__vigilVlmCalls = { records: null }
  return globalState.__vigilVlmCalls
}

/** 新记录在数组头部（时间倒序）。 */
function load(): VlmCallDetail[] {
  const current = state()
  if (current.records) return current.records
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8")) as unknown
    current.records = Array.isArray(parsed) ? (parsed as VlmCallDetail[]) : []
  } catch {
    current.records = []
  }
  return current.records
}

function persist() {
  try {
    fs.mkdirSync(auditDir(), { recursive: true })
    const tmp = `${filePath()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state().records ?? []))
    fs.renameSync(tmp, filePath())
  } catch (error) {
    console.error("[vlm-call-store] 写入调用流水失败：", error instanceof Error ? error.message : error)
  }
}

function removeFrames(id: string) {
  for (let index = 0; index < MAX_SAVED_FRAMES; index += 1) {
    for (const ext of Object.keys(FRAME_MIME)) fs.rmSync(path.join(framesDir(), `${id}-${index}.${ext}`), { force: true })
  }
}

const DATA_URL = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/

function pickFrameIndexes(count: number) {
  if (count <= MAX_SAVED_FRAMES) return Array.from({ length: count }, (_, i) => i)
  return Array.from(new Set([0, Math.floor((count - 1) / 2), count - 1]))
}

function saveFrames(id: string, imageUrls: string[]) {
  let saved = 0
  for (const index of pickFrameIndexes(imageUrls.length)) {
    const match = DATA_URL.exec(imageUrls[index] ?? "")
    if (!match) continue
    const buffer = Buffer.from(match[2], "base64")
    if (buffer.length === 0 || buffer.length > MAX_FRAME_BYTES) continue
    const ext = match[1] === "png" ? "png" : match[1] === "webp" ? "webp" : "jpg"
    try {
      fs.mkdirSync(framesDir(), { recursive: true })
      fs.writeFileSync(path.join(framesDir(), `${id}-${saved}.${ext}`), buffer)
      saved += 1
    } catch (error) {
      console.error("[vlm-call-store] 保存送检帧失败：", error instanceof Error ? error.message : error)
      break
    }
  }
  return saved
}

export interface RecordVlmCallInput {
  trigger: VlmCallTrigger
  streamId?: string | null
  streamName?: string
  alertId?: string | null
  model: string
  protocol: string
  status: VlmCallStatus
  outcome: VlmCallDetail["outcome"]
  ruleName?: string
  confidence?: number | null
  summary?: string
  rules?: VlmCallRuleSnapshot[]
  systemPrompt: string
  userPrompt: string
  output: string
  imageUrls: string[]
  rttMs: number
  promptTokens: number
  completionTokens: number
  usageEstimated: boolean
  costUsd: number
  error?: string
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}\n…（已截断，原文共 ${text.length} 字符）` : text
}

/** 记录一次真实的模型网关调用；无论研判为告警、合规忽略还是失败都会落盘。返回新记录 ID。 */
export function recordVlmCall(input: RecordVlmCallInput): string {
  const id = `vc_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`
  const streamId = input.streamId ?? null
  const streamName = input.streamName?.trim() || (streamId ? (getStream(streamId)?.name ?? streamId) : "—")
  const record: VlmCallDetail = {
    id,
    at: new Date().toISOString(),
    trigger: input.trigger,
    streamId,
    streamName,
    alertId: input.alertId ?? null,
    model: input.model,
    protocol: input.protocol,
    status: input.status,
    outcome: input.outcome,
    ruleName: input.ruleName?.trim() || "—",
    confidence: input.confidence ?? null,
    summary: clip(input.summary ?? "", 300),
    frameCount: input.imageUrls.length,
    savedFrames: saveFrames(id, input.imageUrls),
    rttMs: Math.max(0, Math.round(input.rttMs)),
    promptTokens: Math.max(0, Math.round(input.promptTokens)),
    completionTokens: Math.max(0, Math.round(input.completionTokens)),
    totalTokens: Math.max(0, Math.round(input.promptTokens + input.completionTokens)),
    usageEstimated: input.usageEstimated,
    costUsd: input.costUsd,
    error: input.error,
    rules: (input.rules ?? []).map((rule) => ({ ...rule, description: clip(rule.description, 600) })),
    systemPrompt: clip(input.systemPrompt, MAX_PROMPT_CHARS),
    userPrompt: clip(input.userPrompt, MAX_PROMPT_CHARS),
    output: clip(input.output, MAX_OUTPUT_CHARS),
  }
  const records = load()
  records.unshift(record)
  while (records.length > VLM_CALL_CAPACITY) {
    const dropped = records.pop()
    if (dropped) removeFrames(dropped.id)
  }
  persist()
  return id
}

/** 告警在调用之后才落库，生成后回填案卷 ID。 */
export function attachAlertToCall(callId: string | null | undefined, alertId: string) {
  if (!callId) return
  const record = load().find((item) => item.id === callId)
  if (!record) return
  record.alertId = alertId
  persist()
}

function summarize(detail: VlmCallDetail): VlmCallRecord {
  const { rules: _rules, systemPrompt: _system, userPrompt: _user, output: _output, ...rest } = detail
  return rest
}

function emptyStats(): VlmCallStats {
  return {
    calls: 0,
    succeeded: 0,
    failed: 0,
    alarms: 0,
    dismissed: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    successRate: null,
    byTrigger: Object.fromEntries(VLM_CALL_TRIGGERS.map((trigger) => [trigger, 0])) as Record<VlmCallTrigger, number>,
  }
}

export interface QueryVlmCallsInput {
  limit: number
  offset: number
  status?: VlmCallStatus
  trigger?: VlmCallTrigger
  streamId?: string
  /** ISO 时间；统计只汇总该时刻之后的调用（客户端传本地当日 0 点） */
  since?: string
}

export function queryVlmCalls(input: QueryVlmCallsInput): VlmCallLogsResponse {
  const all = load()
  const sinceMs = input.since ? Date.parse(input.since) : NaN
  const stats = emptyStats()
  for (const record of all) {
    if (Number.isFinite(sinceMs) && Date.parse(record.at) < sinceMs) continue
    stats.calls += 1
    stats.byTrigger[record.trigger] += 1
    if (record.status === "failed") stats.failed += 1
    else stats.succeeded += 1
    if (record.status === "alarm") stats.alarms += 1
    if (record.status === "dismissed") stats.dismissed += 1
    stats.promptTokens += record.promptTokens
    stats.completionTokens += record.completionTokens
    stats.totalTokens += record.totalTokens
    stats.costUsd += record.costUsd
  }
  stats.successRate = stats.calls > 0 ? stats.succeeded / stats.calls : null
  stats.costUsd = Math.round(stats.costUsd * 1e6) / 1e6

  const matched = all.filter(
    (record) =>
      (!input.status || record.status === input.status) &&
      (!input.trigger || record.trigger === input.trigger) &&
      (!input.streamId || record.streamId === input.streamId),
  )
  return {
    status: "ok",
    retained: all.length,
    capacity: VLM_CALL_CAPACITY,
    stats,
    matched: matched.length,
    offset: input.offset,
    limit: input.limit,
    records: matched.slice(input.offset, input.offset + input.limit).map(summarize),
  }
}

export function getVlmCall(id: string): VlmCallDetail | null {
  return load().find((record) => record.id === id) ?? null
}

export function readVlmFrame(id: string, index: number): { buffer: Buffer; mime: string } | null {
  if (!/^vc_[a-z0-9_]+$/i.test(id) || !Number.isInteger(index) || index < 0 || index >= MAX_SAVED_FRAMES) return null
  for (const [ext, mime] of Object.entries(FRAME_MIME)) {
    try {
      return { buffer: fs.readFileSync(path.join(framesDir(), `${id}-${index}.${ext}`)), mime }
    } catch {
      continue
    }
  }
  return null
}

export function clearVlmCalls() {
  state().records = []
  persist()
  fs.rmSync(framesDir(), { recursive: true, force: true })
}
