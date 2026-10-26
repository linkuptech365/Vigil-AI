import { jsonOk } from "@/lib/ops/server/rule-http"
import { getVisionHits } from "@/lib/vision-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return jsonOk(await getVisionHits())
}
