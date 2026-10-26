import type { Tier1Feedback } from "@/lib/ops/types"
import type { VlmFinalResult, VlmSourceType, VlmVerdict } from "@/lib/ops/vlm-api-types"
import { loadAllLearning, loadLearning, saveLearning } from "@/lib/storage/tier1-learning-store"
import { getStream } from "@/lib/storage/streams-store"
import { loadVisionConfig } from "@/lib/storage/vision-store"
import {
  mergeTier1Feedback,
  resetLearning,
  rollbackLearning,
  type Tier1Learning,
  type Tier1MergeResult,
} from "@/lib/vigil/tier1-learning"
import { pushConfig, type PushResult } from "@/lib/vision-engine"

/** 通道一级初筛当前已用的英文检测词（基础词表 + 已沉淀词），提示给 VLM 避免重复推荐。 */
export function tier1ExistingTags(streamId: string): string[] {
  const base = loadVisionConfig().vocabulary.map((item) => item.promptEn)
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
  const merge = mergeTier1Feedback(loadLearning(streamId), streamId, feedback, loadVisionConfig().vocabulary)
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
