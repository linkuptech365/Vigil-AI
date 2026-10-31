import { createProfile, listProfiles, ModelProfileError, toPublic } from "@/lib/ops/server/model-profiles"
import { parseProfileInput } from "@/lib/ops/server/model-profile-input"
import { jsonError, jsonOk, readJsonBody } from "@/lib/ops/server/rule-http"
import type { ModelProfile, ModelsListResponse } from "@/lib/vigil/model-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function respond(profiles: ModelProfile[]): ModelsListResponse {
  return { profiles: profiles.map(toPublic) }
}

export async function GET() {
  return jsonOk(respond(listProfiles()))
}

export async function POST(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)
  const input = parseProfileInput(body.value)
  if (typeof input === "string") return jsonError(400, "INVALID_REQUEST", input)

  try {
    const { id, profiles } = createProfile(input)
    return jsonOk({ ...respond(profiles), id }, 201)
  } catch (error) {
    if (error instanceof ModelProfileError) return jsonError(error.status, error.code, error.message)
    throw error
  }
}
