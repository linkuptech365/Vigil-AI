import { jsonError, jsonOk } from "@/lib/ops/server/rule-http"
import { ModelProfileError, setDefaultProfile, toPublic } from "@/lib/ops/server/model-profiles"
import type { ModelsListResponse } from "@/lib/vigil/model-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  try {
    const body: ModelsListResponse = { profiles: setDefaultProfile(id).map(toPublic) }
    return jsonOk(body)
  } catch (error) {
    if (error instanceof ModelProfileError) return jsonError(error.status, error.code, error.message)
    throw error
  }
}
