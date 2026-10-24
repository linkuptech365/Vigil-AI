import { CompileError, compileInstruction } from "@/lib/ops/server/vision-compiler"
import { jsonError, jsonOk, readJsonBody } from "@/lib/ops/server/rule-http"
import { loadVisionConfig, saveVisionConfig } from "@/lib/storage/vision-store"
import { getVisionInfo, pushConfig } from "@/lib/vision-engine"
import type { CompileResponse } from "@/lib/vigil/vision"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/** 把中文稽查要求编译成英文检测词表，保存并热更新到视觉服务（apply=false 时仅预览）。 */
export async function POST(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)

  const instruction = typeof body.value.instruction === "string" ? body.value.instruction.trim() : ""
  if (instruction.length < 2) return jsonError(400, "INVALID_REQUEST", "请先用中文描述需要稽查的违规行为")
  if (instruction.length > 1000) return jsonError(400, "INVALID_REQUEST", "描述过长，请控制在 1000 字以内")
  const modelProfileId = typeof body.value.modelProfileId === "string" ? body.value.modelProfileId : undefined
  const apply = body.value.apply !== false

  try {
    const outcome = await compileInstruction(instruction, modelProfileId, request.signal)
    const config = { ...loadVisionConfig(), naturalLanguageInstruction: instruction, vocabulary: outcome.vocabulary }
    let reload: CompileResponse["reload"]
    if (apply) {
      saveVisionConfig(config)
      reload = (await pushConfig(true, config)) ?? undefined
    }
    await getVisionInfo()
    const response: CompileResponse = {
      status: "ok",
      source: outcome.source,
      model: outcome.model,
      note: outcome.note,
      vocabulary: outcome.vocabulary,
      config,
      reload,
    }
    return jsonOk(response)
  } catch (error) {
    if (error instanceof CompileError) return jsonError(422, "COMPILE_FAILED", error.message)
    return jsonError(500, "INTERNAL", error instanceof Error ? error.message : "编译失败")
  }
}
