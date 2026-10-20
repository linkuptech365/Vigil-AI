import type { ClusterEventInput } from "@/lib/ops/rules-api-types"
import { CORRELATION_WINDOW_SECONDS } from "@/lib/ops/rules-data"
import { clusterIncidents, findRule, ingestClusterEvents, isKnownChannel } from "@/lib/ops/server/rule-engine"
import {
  isRecord,
  jsonError,
  jsonOk,
  optionalNumber,
  optionalString,
  optionalTimestamp,
  readJsonBody,
  requiredString,
} from "@/lib/ops/server/rule-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_EVENTS_PER_REQUEST = 100

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("windowSeconds")
  let windowSeconds = CORRELATION_WINDOW_SECONDS
  if (raw !== null) {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 5 || parsed > 300) {
      return jsonError(400, "INVALID_REQUEST", "windowSeconds 必须在 5 到 300 之间")
    }
    windowSeconds = parsed
  }
  return jsonOk(clusterIncidents(windowSeconds))
}

export async function POST(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)

  const windowInput = optionalNumber(body.value, "windowSeconds", 5, 300)
  if (!windowInput.ok) return jsonError(400, "INVALID_REQUEST", windowInput.message)

  const rawEvents = body.value.events
  const events: ClusterEventInput[] = []
  if (rawEvents !== undefined) {
    if (!Array.isArray(rawEvents) || rawEvents.length > MAX_EVENTS_PER_REQUEST) {
      return jsonError(400, "INVALID_REQUEST", `events 必须是数组，且不超过 ${MAX_EVENTS_PER_REQUEST} 条`)
    }
    for (const [index, item] of rawEvents.entries()) {
      if (!isRecord(item)) return jsonError(400, "INVALID_REQUEST", `events[${index}] 必须是对象`)

      const channelId = requiredString(item, "channelId", 32)
      if (!channelId.ok) return jsonError(400, "INVALID_REQUEST", `events[${index}].${channelId.message}`)
      if (!isKnownChannel(channelId.value)) {
        return jsonError(404, "CHANNEL_NOT_FOUND", `events[${index}] 未知通道 ${channelId.value}`)
      }

      const ruleId = optionalString(item, "ruleId", 32)
      if (!ruleId.ok) return jsonError(400, "INVALID_REQUEST", `events[${index}].${ruleId.message}`)
      if (ruleId.value && !findRule(ruleId.value)) {
        return jsonError(404, "RULE_NOT_FOUND", `events[${index}] 规则 ${ruleId.value} 不存在`)
      }

      const timestamp = optionalTimestamp(item, "timestamp")
      if (!timestamp.ok) return jsonError(400, "INVALID_REQUEST", `events[${index}].${timestamp.message}`)

      const tags = item.tags
      if (tags !== undefined && !(Array.isArray(tags) && tags.every((tag) => typeof tag === "string"))) {
        return jsonError(400, "INVALID_REQUEST", `events[${index}].tags 必须是字符串数组`)
      }

      events.push({
        channelId: channelId.value,
        ruleId: ruleId.value || undefined,
        timestamp: timestamp.value,
        tags: tags as string[] | undefined,
      })
    }
  }

  if (events.length > 0) ingestClusterEvents(events)
  return jsonOk(clusterIncidents(windowInput.value ?? CORRELATION_WINDOW_SECONDS))
}
