import { loadAllChannelPerception, loadChannelPerception } from "@/lib/storage/channel-perception-store"
import { loadLearning } from "@/lib/storage/tier1-learning-store"
import { loadVisionConfig } from "@/lib/storage/vision-store"
import type { ChannelConfigResponse, CompiledTag } from "@/lib/vigil/channel-perception"
import { emptyLearning, type Tier1LearningState } from "@/lib/vigil/tier1-learning"

/** 某通道的基础检测词表：有专属词表用专属词表，否则沿用全局默认词表。 */
export function effectiveVocabulary(channelId: string): { tags: CompiledTag[]; source: "channel" | "default" } {
  const own = loadChannelPerception(channelId)
  if (own && own.compiled_tags.length > 0) return { tags: own.compiled_tags, source: "channel" }
  return { tags: loadVisionConfig().vocabulary, source: "default" }
}

/** 下发给视觉服务的通道专属词表；没有专属词表的通道不下发，由 Worker 回落到全局默认。 */
export function channelVocabularies(): Record<string, CompiledTag[]> {
  const out: Record<string, CompiledTag[]> = {}
  for (const [channelId, stored] of Object.entries(loadAllChannelPerception())) {
    if (stored.compiled_tags.length > 0) out[channelId] = stored.compiled_tags
  }
  return out
}

function learningState(channelId: string): Tier1LearningState {
  const { streamId: _streamId, history: _history, ...state } = loadLearning(channelId) ?? emptyLearning(channelId)
  return state
}

export function buildChannelConfig(channelId: string): ChannelConfigResponse {
  const stored = loadChannelPerception(channelId)
  const effective = effectiveVocabulary(channelId)
  return {
    status: "ok",
    config: {
      channelId,
      raw_prompt: stored?.raw_prompt ?? "",
      compiled_tags: stored?.compiled_tags ?? [],
      learning_state: learningState(channelId),
    },
    configured: effective.source === "channel",
    source: effective.source,
    effective_tags: effective.tags,
    updatedAt: stored?.updatedAt ?? null,
  }
}
