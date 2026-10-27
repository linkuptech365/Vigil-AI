import { jsonError, jsonOk, readJsonBody } from "@/lib/ops/server/rule-http"
import { loadAllLearning, mergeLearnedIntoChannelVocabulary, resetTier1Learning, rollbackTier1Learning } from "@/lib/ops/server/tier1-feedback"
import { getStream } from "@/lib/storage/streams-store"
import type { Tier1LearningResponse } from "@/lib/vigil/tier1-learning"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const body: Tier1LearningResponse = { status: "ok", learning: loadAllLearning() }
  return jsonOk(body)
}

/** 重置（恢复初始词表、清除锚点）或回滚到上一版本；两者都会写入版本历史并立即热更新视觉服务。 */
export async function POST(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)
  const value = body.value as { streamId?: unknown; action?: unknown } | null
  const streamId = typeof value?.streamId === "string" ? value.streamId : ""
  if (!streamId || !getStream(streamId)) return jsonError(404, "STREAM_NOT_FOUND", "通道不存在")

  if (value?.action === "reset") {
    const { reload } = await resetTier1Learning(streamId)
    const response: Tier1LearningResponse = { status: "ok", learning: loadAllLearning(), reload: reload ?? undefined }
    return jsonOk(response)
  }
  if (value?.action === "rollback") {
    const outcome = await rollbackTier1Learning(streamId)
    if (!outcome) return jsonError(409, "NO_HISTORY", "没有可回滚的历史版本")
    const response: Tier1LearningResponse = { status: "ok", learning: loadAllLearning(), reload: outcome.reload ?? undefined }
    return jsonOk(response)
  }
  if (value?.action === "merge") {
    const outcome = await mergeLearnedIntoChannelVocabulary(streamId)
    if (!outcome) return jsonError(409, "NO_LEARNED_TAGS", "当前通道尚无二级反哺词条可并入")
    const response: Tier1LearningResponse = {
      status: "ok",
      learning: loadAllLearning(),
      reload: outcome.reload ?? undefined,
      merge: { added: outcome.added, skipped: outcome.skipped, reenabled: outcome.reenabled, total: outcome.total },
    }
    return jsonOk(response)
  }
  return jsonError(400, "INVALID_ACTION", "action 必须是 reset、rollback 或 merge")
}
