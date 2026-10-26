import { alertSubjects, parseSearchQuery, SUBJECT_LABEL, type ChannelRef } from "@/lib/ops/video-search"
import type { RagDoc, RagHit, RagIndexStatus, RagSearchResponse, VlmCandidate } from "@/lib/ops/rag-types"
import { loadRagDocs, ragIndexPath, writeRagDocs } from "@/lib/storage/rag-store"
import { loadAlerts, loadStreams } from "@/lib/storage/streams-store"
import type { StreamAlert } from "@/lib/vigil/streams"

const ENGINE_LABEL = "BM25 本地倒排检索（告警 / 二级研判结论文本）"
const MAX_CANDIDATES = 60

/** 中文按二字切分，英文数字按单词，足以支撑短语检索，无需外部分词器。 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const part of text.toLowerCase().match(/[\u4e00-\u9fa5]+|[a-z0-9]+/g) ?? []) {
    if (/^[\u4e00-\u9fa5]+$/.test(part)) {
      if (part.length === 1) tokens.push(part)
      for (let i = 0; i < part.length - 1; i += 1) tokens.push(part.slice(i, i + 2))
    } else {
      tokens.push(part)
    }
  }
  return tokens
}

function signatureOf(alert: StreamAlert) {
  const actions = alert.case?.actions.length ?? 0
  return [alert.id, alert.summary, alert.vlm?.analyzedAt ?? "", alert.case?.status ?? "", actions, alert.case?.closedAt ?? ""].join("|")
}

export function docFromAlert(alert: StreamAlert): RagDoc {
  const vlm = alert.vlm
  const summary = vlm?.result.summary || alert.summary
  const text = [
    summary,
    alert.summary,
    alert.ruleName,
    alert.streamName,
    alert.zone,
    alert.reasoning,
    vlm?.reasoning ?? "",
    vlm?.action ?? "",
    vlm?.medium ?? "",
    vlm?.exclusion?.reason ?? "",
    vlm?.result.advice ?? "",
    (alert.tags ?? []).join(" "),
    (alert.case?.actions ?? []).map((a) => a.notes).join(" "),
  ]
    .filter(Boolean)
    .join("\n")
  return {
    id: alert.id,
    alertId: alert.id,
    caseId: alert.case?.caseId ?? null,
    streamId: alert.streamId,
    streamName: alert.streamName,
    zone: alert.zone,
    ruleId: alert.ruleId,
    ruleName: alert.ruleName,
    severity: alert.severity,
    confidence: alert.confidence,
    triggeredAt: alert.triggeredAt,
    summary,
    text,
    subjects: alertSubjects({ tags: alert.tags, ruleName: alert.ruleName, summary: alert.summary, edge: alert.edge, fine: alert.fine }),
    hasVlm: Boolean(vlm),
    vlmAnalyzedAt: vlm?.analyzedAt,
    archived: Boolean(alert.case?.closedAt),
    frameCount: alert.frames.length,
    signature: signatureOf(alert),
    indexedAt: new Date().toISOString(),
  }
}

/** 让索引与告警库保持一致：新增、变更重建，已被清理的告警移除。返回最新文档。 */
export function syncRagIndex(): RagDoc[] {
  const alerts = loadAlerts()
  const existing = new Map(loadRagDocs().map((doc) => [doc.alertId, doc]))
  let changed = existing.size !== alerts.length
  const docs = alerts.map((alert) => {
    const prev = existing.get(alert.id)
    if (prev && prev.signature === signatureOf(alert)) return prev
    changed = true
    return docFromAlert(alert)
  })
  if (changed) writeRagDocs(docs)
  return docs
}

/** 研判完成、案卷变更后立即入库，不必等下一次检索。 */
export function indexAlertNow(alertId: string) {
  try {
    syncRagIndex()
  } catch (error) {
    console.error(`[rag] 告警 ${alertId} 入库索引失败：`, error)
  }
}

export function ragStatus(docs: RagDoc[]): RagIndexStatus {
  return {
    docs: docs.length,
    vlmDocs: docs.filter((doc) => doc.hasVlm).length,
    archivedDocs: docs.filter((doc) => doc.archived).length,
    lastIndexedAt: docs.reduce<string | null>((latest, doc) => (!latest || doc.indexedAt > latest ? doc.indexedAt : latest), null),
    engine: ENGINE_LABEL,
    storagePath: ragIndexPath().replace(/^.*[\\/](data[\\/])/, "$1"),
  }
}

function bestSnippet(doc: RagDoc, queryTokens: Set<string>) {
  const sentences = doc.text.split(/[\n。；;]/).map((s) => s.trim()).filter(Boolean)
  let best = doc.summary
  let bestScore = 0
  for (const sentence of sentences) {
    const hit = new Set(tokenize(sentence).filter((t) => queryTokens.has(t))).size
    if (hit > bestScore) {
      bestScore = hit
      best = sentence
    }
  }
  return best.length > 140 ? `${best.slice(0, 140)}…` : best
}

export function searchRag(query: string, topK: number): RagSearchResponse {
  const docs = syncRagIndex()
  const channelMap = new Map<string, ChannelRef>()
  for (const stream of loadStreams()) channelMap.set(stream.id, { id: stream.id, name: stream.name, zone: stream.zone })
  for (const doc of docs) {
    if (!channelMap.has(doc.streamId)) channelMap.set(doc.streamId, { id: doc.streamId, name: doc.streamName, zone: doc.zone })
  }
  const channels = [...channelMap.values()]
  const parsed = parseSearchQuery(query, channels)

  const queryTokens = [...new Set(tokenize(parsed.terms.join(" ")))]
  const tokenSet = new Set(queryTokens)

  const candidates = docs.filter((doc) => {
    if (parsed.channel.unresolved) return false
    if (parsed.channel.channelIds && !parsed.channel.channelIds.includes(doc.streamId)) return false
    if (parsed.subjects.length > 0 && !parsed.subjects.some((s) => doc.subjects.includes(s))) return false
    return true
  })

  const docTokens = candidates.map((doc) => tokenize(doc.text))
  const avgLen = docTokens.reduce((sum, t) => sum + t.length, 0) / Math.max(1, docTokens.length)
  const df = new Map<string, number>()
  for (const token of queryTokens) df.set(token, docTokens.filter((t) => t.includes(token)).length)

  const k1 = 1.5
  const b = 0.75
  const scored = candidates.map((doc, i) => {
    const tokens = docTokens[i]
    let score = 0
    const matched: string[] = []
    for (const token of queryTokens) {
      const tf = tokens.filter((t) => t === token).length
      if (tf === 0) continue
      matched.push(token)
      const n = df.get(token) ?? 0
      const idf = Math.log(1 + (candidates.length - n + 0.5) / (n + 0.5))
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * tokens.length) / Math.max(1, avgLen))))
    }
    return { doc, score, matched }
  })

  const hasTerms = queryTokens.length > 0
  const ranked = scored
    .filter((entry) => (hasTerms ? entry.score > 0 : true))
    .sort((a, c) => (hasTerms ? c.score - a.score : 0) || c.doc.triggeredAt.localeCompare(a.doc.triggeredAt))
  const top = ranked[0]?.score ?? 0

  const hits: RagHit[] = ranked.slice(0, topK).map(({ doc, score, matched }) => ({
    id: doc.id,
    alertId: doc.alertId,
    caseId: doc.caseId,
    channelId: doc.streamId,
    channelName: doc.streamName,
    zone: doc.zone,
    ruleName: doc.ruleName,
    severity: doc.severity,
    triggeredAt: doc.triggeredAt,
    score: hasTerms ? Math.round(Math.max(1, (score / top) * 100)) : Math.round(doc.confidence <= 1 ? doc.confidence * 100 : doc.confidence),
    matchedText: hasTerms ? bestSnippet(doc, tokenSet) : doc.summary,
    matchedTerms: matched,
    thumbnailUrl: doc.frameCount > 0 ? `/api/v1/stream-alerts/${encodeURIComponent(doc.alertId)}/frames/1` : null,
    hasVlm: doc.hasVlm,
    archived: doc.archived,
  }))

  return {
    status: "success",
    query,
    hits,
    total: ranked.length,
    index: ragStatus(docs),
    filters: {
      channelNames: parsed.channel.channelIds ? channels.filter((c) => parsed.channel.channelIds?.includes(c.id)).map((c) => c.name) : [],
      channelUnresolved: parsed.channel.unresolved,
      subjects: parsed.subjects.map((key) => SUBJECT_LABEL[key]),
    },
  }
}

export function listVlmCandidates(): VlmCandidate[] {
  return loadAlerts()
    .slice()
    .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt))
    .slice(0, MAX_CANDIDATES)
    .map((alert) => ({
      alertId: alert.id,
      caseId: alert.case?.caseId ?? null,
      channelId: alert.streamId,
      channelName: alert.streamName,
      zone: alert.zone,
      triggeredAt: alert.triggeredAt,
      ruleId: alert.ruleId,
      ruleName: alert.ruleName,
      severity: alert.severity,
      tier1Summary: alert.summary,
      tier1Reasoning: alert.reasoning,
      frameCount: alert.frames.length,
      thumbnailUrl: alert.frames.length > 0 ? `/api/v1/stream-alerts/${encodeURIComponent(alert.id)}/frames/1` : null,
      edge: alert.edge,
      vlm: alert.vlm,
    }))
}
