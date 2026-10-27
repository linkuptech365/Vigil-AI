import type { Tier1Feedback } from "@/lib/ops/types"
import type { VlmFinalResult, VlmSourceType, VlmVerdict } from "@/lib/ops/vlm-api-types"
import { loadAllLearning, loadLearning, saveLearning } from "@/lib/storage/tier1-learning-store"
import { getStream } from "@/lib/storage/streams-store"
import { effectiveVocabulary } from "@/lib/ops/server/channel-perception"
import {
  applyFalsePositive,
  type FalsePositiveInput,
  mergeTier1Feedback,
  resetLearning,
  rollbackLearning,
  type Tier1Learning,
  type Tier1MergeResult,
} from "@/lib/vigil/tier1-learning"
import { loadChannelPerception, saveChannelPerception } from "@/lib/storage/channel-perception-store"
import { mergeVocabulary, type VocabularyItem } from "@/lib/vigil/vision"
import { pushConfig, type PushResult } from "@/lib/vision-engine"

/** 通道一级初筛当前已用的英文检测词（基础词表 + 已沉淀词），提示给 VLM 避免重复推荐。 */
export function tier1ExistingTags(streamId: string): string[] {
  const base = effectiveVocabulary(streamId).tags.map((item) => item.promptEn)
  const learned = loadLearning(streamId)?.tags.map((tag) => tag.promptEn) ?? []
  return [...new Set([...base, ...learned])]
}

/** 只有实时通道才有一级初筛可反哺；本地视频等来源返回 undefined。 */
export function tier1ExistingForSource(sourceType: VlmSourceType | undefined, sourceKey: string): string[] | undefined {
  if (sourceType !== "channel" || !getStream(sourceKey)) return undefined
  return tier1ExistingTags(sourceKey)
}

export interface Tier1ApplyOutcome {
  merge: Tier1MergeResult
  reload: PushResult | null
}

/** 合并、持久化并热更新到视觉工作进程；无实质变化时不写盘也不重载。 */
export async function applyTier1Feedback(streamId: string, feedback: Tier1Feedback): Promise<Tier1ApplyOutcome> {
  const merge = mergeTier1Feedback(loadLearning(streamId), streamId, feedback, effectiveVocabulary(streamId).tags)
  if (!merge.changed) return { merge, reload: null }
  saveLearning(merge.learning)
  const reload = await pushConfig(true)
  console.log(
    `[tier1-feedback] ${streamId} → v${merge.learning.version}：${merge.learning.note}（重复 ${merge.skippedDuplicate}，超上限 ${merge.skippedByCap}）`
  )
  return { merge, reload }
}

/**
 * 二级研判结束后调用：判定成立且带有有效反馈时，异步沉淀到该通道一级初筛，不阻塞研判响应。
 */
export function feedbackFromAnalysis(
  sourceType: VlmSourceType | undefined,
  sourceKey: string,
  result: VlmFinalResult,
  verdict: VlmVerdict
) {
  if (sourceType !== "channel" || !verdict.triggered || !result.tier1Feedback || !getStream(sourceKey)) return
  void applyTier1Feedback(sourceKey, result.tier1Feedback).catch((error) =>
    console.error("[tier1-feedback] 回写一级初筛失败：", error)
  )
}

/** 该通道由误报反馈沉淀的负条件与规则门槛上调值，每次二级研判前读取。 */
export function learnedRuleTuning(streamId: string): { exclusions: string[]; sensitivityBoost: Record<string, number> } {
  const learning = loadLearning(streamId)
  return { exclusions: learning?.exclusions ?? [], sensitivityBoost: learning?.sensitivityBoost ?? {} }
}

export interface FalsePositiveApplied {
  changed: boolean
  version: number | null
  note: string | null
  reload: PushResult | null
}

/** 用户标记误报后调用：负条件进入后续研判提示词，规则门槛上调，误报点位记为排除锚点并热更新。 */
export async function applyTier1FalsePositive(streamId: string, input: FalsePositiveInput): Promise<FalsePositiveApplied> {
  const merge = applyFalsePositive(loadLearning(streamId), streamId, input)
  if (!merge.changed) return { changed: false, version: merge.learning.version || null, note: null, reload: null }
  saveLearning(merge.learning)
  const hasHotspot = (merge.learning.microHotspots ?? []).length > 0
  const reload = hasHotspot ? await pushConfig(true) : null
  console.log(`[tier1-feedback] ${streamId} 误报反馈 → v${merge.learning.version}：${merge.learning.note}`)
  return { changed: true, version: merge.learning.version, note: merge.learning.note, reload }
}

export interface LearnedMergeOutcome {
  added: number
  skipped: number
  reenabled: number
  total: number
  reload: PushResult | null
}

/** 把二级反哺沉淀的词条一键并入该通道专属词表（写入 compiled_tags），并热更新视觉服务；已存在的英文词会被去重或重新启用。 */
export async function mergeLearnedIntoChannelVocabulary(streamId: string): Promise<LearnedMergeOutcome | null> {
  const learning = loadLearning(streamId)
  if (!learning || learning.tags.length === 0) return null
  const stored = loadChannelPerception(streamId)
  // 只在已持久化词条的基础上追加：不把规则临时合成的类别固化进存储，规则变更后仍能随之增减
  const base = stored?.compiled_tags ?? []
  const incoming: VocabularyItem[] = learning.tags.map((tag) => ({
    id: "",
    labelZh: tag.labelZh,
    promptEn: tag.promptEn,
    role: tag.role,
    enabled: true,
  }))
  const merge = mergeVocabulary(base, incoming)
  if (merge.added === 0 && merge.reenabled === 0) {
    return { added: 0, skipped: merge.skipped, reenabled: 0, total: merge.vocabulary.length, reload: null }
  }
  saveChannelPerception(streamId, {
    raw_prompt: stored?.raw_prompt ?? "",
    compiled_tags: merge.vocabulary,
    updatedAt: new Date().toISOString(),
  })
  const reload = await pushConfig(true)
  console.log(`[tier1-feedback] ${streamId} 二级词条并入专属词表：新增 ${merge.added}，重新启用 ${merge.reenabled}`)
  return { added: merge.added, skipped: merge.skipped, reenabled: merge.reenabled, total: merge.vocabulary.length, reload }
}

export async function resetTier1Learning(streamId: string): Promise<{ learning: Tier1Learning; reload: PushResult | null }> {
  const learning = resetLearning(loadLearning(streamId), streamId)
  saveLearning(learning)
  return { learning, reload: await pushConfig(true) }
}

export async function rollbackTier1Learning(streamId: string): Promise<{ learning: Tier1Learning; reload: PushResult | null } | null> {
  const learning = rollbackLearning(loadLearning(streamId), streamId)
  if (!learning) return null
  saveLearning(learning)
  return { learning, reload: await pushConfig(true) }
}

export { loadAllLearning }
