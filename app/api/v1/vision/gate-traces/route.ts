import { jsonOk } from "@/lib/ops/server/rule-http"
import { getGateTraces } from "@/lib/vision-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const limit = Number(params.get("limit"))
  return jsonOk(
    await getGateTraces({
      streamId: params.get("streamId") ?? undefined,
      ruleId: params.get("ruleId") ?? undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    }),
  )
}
