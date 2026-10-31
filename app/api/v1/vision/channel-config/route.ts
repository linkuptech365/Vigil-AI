import { buildChannelConfig } from "@/lib/ops/server/channel-perception"
import { jsonError, jsonOk, readJsonBody } from "@/lib/ops/server/rule-http"
import { deriveChannelBinding } from "@/lib/ops/server/rule-vocabulary"
import { CompileError, compileInstruction } from "@/lib/ops/server/vision-compiler"
import { deleteChannelPerception, loadChannelPerception, saveChannelPerception } from "@/lib/storage/channel-perception-store"
import { getStream } from "@/lib/storage/streams-store"
import type { ChannelCompileSummary, ChannelConfigResponse, CompiledTag } from "@/lib/vigil/channel-perception"
import { mergeVocabulary, sanitizeVocabulary } from "@/lib/vigil/vision"
import { getVisionInfo, pushConfig } from "@/lib/vision-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const TRACKED_ROLES = new Set(["anchor_person", "subject_target"])

/** 获取指定通道的初筛配置与词表。 */
export async function GET(request: Request) {
  const channelId = new URL(request.url).searchParams.get("channelId")?.trim() ?? ""
  if (!channelId) return jsonError(400, "INVALID_REQUEST", "缺少 channelId")
  if (!getStream(channelId)) return jsonError(404, "NOT_FOUND", "该通道不是实时通道，没有独立的初筛配置")
  return jsonOk(buildChannelConfig(channelId))
}

/**
 * 更新指定通道的提示词与词表并热更新视觉服务。
 * - compile=true：把 raw_prompt 编译为英文词表（mode 默认 replace，append 则合并进现有专属词表）
 * - 否则直接保存 compiled_tags（手动增删）
 * - reset=true：清除专属配置，回落到全局默认词表
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)

  const channelId = typeof body.value.channelId === "string" ? body.value.channelId.trim() : ""
  if (!channelId) return jsonError(400, "INVALID_REQUEST", "缺少 channelId")
  if (!getStream(channelId)) return jsonError(404, "NOT_FOUND", "该通道不是实时通道，没有独立的初筛配置")

  const stored = loadChannelPerception(channelId)
  const rawPrompt = typeof body.value.raw_prompt === "string" ? body.value.raw_prompt.trim() : (stored?.raw_prompt ?? "")
  if (rawPrompt.length > 1000) return jsonError(400, "INVALID_REQUEST", "描述过长，请控制在 1000 字以内")

  let compileSummary: ChannelCompileSummary | undefined
  let tags: CompiledTag[] | null = null

  if (body.value.reset === true) {
    deleteChannelPerception(channelId)
  } else {
    if (body.value.compile === true) {
      if (rawPrompt.length < 2) return jsonError(400, "INVALID_REQUEST", "请先用中文描述该通道需要稽查的内容")
      const mode: "append" | "replace" = body.value.mode === "append" ? "append" : "replace"
      const modelProfileId = typeof body.value.modelProfileId === "string" ? body.value.modelProfileId : undefined
      try {
        const outcome = await compileInstruction(rawPrompt, modelProfileId, request.signal)
        const merge =
          mode === "append"
            ? mergeVocabulary(stored?.compiled_tags ?? [], outcome.vocabulary)
            : { vocabulary: outcome.vocabulary, added: outcome.vocabulary.length, skipped: 0, reenabled: 0 }
        tags = merge.vocabulary
        compileSummary = {
          source: outcome.source,
          model: outcome.model,
          note: outcome.note,
          mode,
          tags: outcome.vocabulary,
          added: merge.added,
          skipped: merge.skipped,
          reenabled: merge.reenabled,
        }
      } catch (error) {
        if (error instanceof CompileError) return jsonError(422, "COMPILE_FAILED", error.message)
        return jsonError(500, "INTERNAL", error instanceof Error ? error.message : "编译失败")
      }
    } else if (body.value.compiled_tags !== undefined) {
      tags = sanitizeVocabulary(body.value.compiled_tags)
      if (!tags) return jsonError(400, "INVALID_REQUEST", "compiled_tags 格式不正确")
    } else if (typeof body.value.raw_prompt !== "string") {
      return jsonError(400, "INVALID_REQUEST", "没有需要更新的内容")
    }

    const finalTags = tags ?? stored?.compiled_tags ?? []
    // 通道有启用规则时，主体由规则引用的类别提供，此处不强制专属词条自带主体
    const ruleSubjects = deriveChannelBinding(channelId).classes.some((entry) => entry.kind === "subject")
    if (finalTags.length > 0 && !ruleSubjects && !finalTags.some((tag) => tag.enabled && TRACKED_ROLES.has(tag.role))) {
      return jsonError(400, "NO_SUBJECT", "词表中至少需要启用一个主体锚点或行为主体")
    }
    saveChannelPerception(channelId, { raw_prompt: rawPrompt, compiled_tags: finalTags, updatedAt: new Date().toISOString() })
  }

  const reload = (await pushConfig(true)) ?? undefined
  await getVisionInfo()
  const response: ChannelConfigResponse = { ...buildChannelConfig(channelId), compile: compileSummary, reload }
  return jsonOk(response)
}
