import { deleteProfile, ModelProfileError, toPublic, updateProfile } from "@/lib/ops/server/model-profiles"
import { parseProfileInput } from "@/lib/ops/server/model-profile-input"
import { jsonError, jsonOk, readJsonBody } from "@/lib/ops/server/rule-http"
import type { ModelProfile, ModelsListResponse } from "@/lib/vigil/model-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function respond(profiles: ModelProfile[]): ModelsListResponse {
  return { profiles: profiles.map(toPublic) }
}

function handle(error: unknown) {
  if (error instanceof ModelProfileError) return jsonError(error.status, error.code, error.message)
  throw error
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)
  const input = parseProfileInput(body.value)
  if (typeof input === "string") return jsonError(400, "INVALID_REQUEST", input)

  try {
    return jsonOk(respond(updateProfile(id, input)))
  } catch (error) {
    return handle(error)
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  try {
    return jsonOk(respond(deleteProfile(id)))
  } catch (error) {
    return handle(error)
  }
}
