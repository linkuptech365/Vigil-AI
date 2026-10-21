export type VlmSeverity = "SAFE" | "INFO" | "WARNING" | "CRITICAL"
export type VlmPhase = "idle" | "thinking" | "streaming" | "done"

export interface VlmModelConfig {
  id: string
  name: string
  provider: string
  latencyMs: number
  contextWindow: string
  costPer1kTokens: number
}

export interface VlmTokenUsage {
  prompt: number
  completion: number
  totalCost: number
}

export interface VlmReasoningResult {
  eventId: string
  channelId: string
  modelUsed: string
  confidence: number
  severity: VlmSeverity
  summary: string
  reasoningChain: string[]
  evidenceKeyframes: number[]
  violationClauses: string[]
  actionAdvice: string
  rawJson: Record<string, unknown>
  tokenUsage: VlmTokenUsage
}

export interface RagSearchResult {
  id: string
  channelId: string
  channelName: string
  timeRange: string
  similarityScore: number
  thumbnail: string
  matchedText: string
}

export interface RagCorpusEntry extends Omit<RagSearchResult, "similarityScore"> {
  keywords: string[]
}

export interface VlmScenario {
  title: string
  cvSaw: string
  cvNote: string
  intent: string
  severity: VlmSeverity
  baseConfidence: number
  clause: string
  chain: string[]
  evidence: number[]
  captions: string[]
  actions: string[]
}
