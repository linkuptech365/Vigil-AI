import { NextResponse } from "next/server"

import type { SearchMoment } from "@/lib/ops/types"
import {
  alertSubjects,
  parseSearchQuery,
  scoreCandidate,
  SUBJECT_LABEL,
  type ChannelRef,
} from "@/lib/ops/video-search"
import { loadAlerts, loadStreams } from "@/lib/storage/streams-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_QUERY_LENGTH = 200
const DEFAULT_TOP_K = 12

function clockOf(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "00:00:00"
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date)
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { query?: unknown; topK?: unknown } | null
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, MAX_QUERY_LENGTH) : ""
  if (!query) return NextResponse.json({ status: "error", message: "请输入检索内容" }, { status: 400 })
  const topK = typeof body?.topK === "number" && body.topK > 0 ? Math.min(50, Math.floor(body.topK)) : DEFAULT_TOP_K

  const alerts = loadAlerts()
  const channelMap = new Map<string, ChannelRef>()
  for (const stream of loadStreams()) channelMap.set(stream.id, { id: stream.id, name: stream.name, zone: stream.zone })
  for (const alert of alerts) {
    if (!channelMap.has(alert.streamId)) channelMap.set(alert.streamId, { id: alert.streamId, name: alert.streamName, zone: alert.zone })
  }
  const channels = [...channelMap.values()]

  const parsed = parseSearchQuery(query, channels)

  const moments: SearchMoment[] = alerts
    .map((alert) => {
      const subjects = alertSubjects(alert)
      const scored = scoreCandidate(parsed, {
        id: alert.id,
        channelId: alert.streamId,
        confidence: alert.confidence,
        subjects,
        text: `${alert.summary} ${alert.ruleName} ${alert.reasoning}`,
      })
      return scored ? { alert, subjects, score: scored.score } : null
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.score - a.score || b.alert.triggeredAt.localeCompare(a.alert.triggeredAt))
    .slice(0, topK)
    .map(({ alert, subjects, score }) => ({
      id: alert.id,
      cameraId: alert.streamId,
      cameraLabel: alert.streamName,
      start: clockOf(alert.triggeredAt),
      end: clockOf(alert.triggeredAt),
      score,
      title: alert.ruleName,
      rationale: alert.summary,
      keywords: subjects.map((key) => SUBJECT_LABEL[key]),
      box: { x: 0, y: 0, w: 0, h: 0, tone: "warn" as const },
      imageUrl: alert.frames.length ? `/api/v1/stream-alerts/${encodeURIComponent(alert.id)}/frames/1` : undefined,
    }))

  const matchedChannels = parsed.channel.channelIds
    ? channels.filter((channel) => parsed.channel.channelIds?.includes(channel.id)).map((channel) => channel.name)
    : []

  return NextResponse.json(
    {
      status: "success",
      moments,
      filters: {
        channelNames: matchedChannels,
        channelUnresolved: parsed.channel.unresolved,
        channelPhrases: parsed.channel.phrases,
        subjects: parsed.subjects.map((key) => SUBJECT_LABEL[key]),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
