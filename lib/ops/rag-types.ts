import type { AlertVlmAnalysis } from "@/lib/vigil/streams"
import type { SubjectKey } from "./video-search"

/** Video-RAG 索引中的一条文档：一条告警（案卷）对应一条，由研判结论与处置过程合成可检索文本。 */
export interface RagDoc {
  id: string
  alertId: string
  caseId: string | null
  streamId: string
  streamName: string
  zone: string
  ruleId: string
  ruleName: string
  severity: "INFO" | "WARNING" | "CRITICAL"
  confidence: number
  triggeredAt: string
  /** 研判结论文本（二级多模态结论优先，否则取告警入库时的结论） */
  summary: string
  /** 参与检索的完整文本，含推理依据、四要素、处置记录 */
  text: string
  subjects: SubjectKey[]
  hasVlm: boolean
  vlmAnalyzedAt?: string
  archived: boolean
  frameCount: number
  /** 用于判断索引是否过期的内容签名 */
  signature: string
  indexedAt: string
}

export interface RagIndexFile {
  version: 1
  docs: RagDoc[]
}

export interface RagIndexStatus {
  docs: number
  vlmDocs: number
  archivedDocs: number
  lastIndexedAt: string | null
  engine: string
  storagePath: string
}

export interface RagHit {
  id: string
  alertId: string
  caseId: string | null
  channelId: string
  channelName: string
  zone: string
  ruleName: string
  severity: RagDoc["severity"]
  triggeredAt: string
  /** 0 ~ 100，对本次查询命中集合内最高分做归一化 */
  score: number
  matchedText: string
  matchedTerms: string[]
  thumbnailUrl: string | null
  hasVlm: boolean
  archived: boolean
}

export interface RagSearchResponse {
  status: "success"
  query: string
  hits: RagHit[]
  total: number
  index: RagIndexStatus
  filters: { channelNames: string[]; channelUnresolved: boolean; subjects: string[] }
}

export type RagCaseFilter = "all" | "vlm" | "pending" | "archived"

export const RAG_CASE_FILTERS: readonly RagCaseFilter[] = ["all", "vlm", "pending", "archived"]

/** 全量案卷列表中的一条记录：不经过检索打分，直接展示索引中的原始文档。 */
export interface RagCase {
  id: string
  alertId: string
  caseId: string | null
  channelId: string
  channelName: string
  zone: string
  ruleName: string
  severity: RagDoc["severity"]
  confidence: number
  triggeredAt: string
  indexedAt: string
  /** 一级初筛入库时的结论 */
  tier1Summary: string
  hasVlm: boolean
  vlmAnalyzedAt: string | null
  /** 二级研判结论；未研判时为 null */
  vlmSummary: string | null
  /** 二级研判是否判定为有效预警；未研判时为 null */
  vlmTriggered: boolean | null
  archived: boolean
  /** 参与 BM25 检索的合成文本（四要素、推理依据、处置记录） */
  text: string
  frameCount: number
  thumbnailUrl: string | null
  frameUrls: string[]
}

export interface RagCaseCounts {
  all: number
  vlm: number
  pending: number
  archived: number
}

export interface RagCasesResponse {
  status: "success"
  filter: RagCaseFilter
  cases: RagCase[]
  /** 当前筛选条件下的总数，可能大于本次返回条数 */
  total: number
  limit: number
  counts: RagCaseCounts
  index: RagIndexStatus
}

/** 二级研判页的候选切片：来自一级初筛真实命中的告警。 */
export interface VlmCandidate {
  alertId: string
  caseId: string | null
  channelId: string
  channelName: string
  zone: string
  triggeredAt: string
  ruleId: string
  ruleName: string
  severity: RagDoc["severity"]
  tier1Summary: string
  frameCount: number
  thumbnailUrl: string | null
  edge?: { trackId: string; edgeConfidence: number; label?: string }
  /** 一级留存的完整推理依据 */
  tier1Reasoning: string
  /** 已有的二级多模态研判结论；刷新页面后据此回显 */
  vlm?: AlertVlmAnalysis
}
