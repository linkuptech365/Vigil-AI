import { NextResponse } from "next/server"

import { isBlockedHost } from "@/lib/ops/server/url-guard"
import { loadStreams, writeStreams } from "@/lib/storage/streams-store"
import { getStreamViews, registerStream } from "@/lib/stream-engine"
import {
  RESERVED_STREAM_IDS,
  STREAM_ID_PATTERN,
  STREAM_ZONES,
  slugifyStreamId,
  validateSourceUrl,
  type StreamMeta,
} from "@/lib/vigil/streams"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function fail(message: string, status: number, code?: string) {
  return NextResponse.json({ status: "error", message, error: code }, { status })
}

export async function GET() {
  return NextResponse.json(await getStreamViews(), { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return fail("请求体不是合法的 JSON", 400, "BAD_JSON")
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : ""
  const zone = typeof body.zone === "string" && body.zone.trim() ? body.zone.trim().slice(0, 40) : STREAM_ZONES[5]
  const source = typeof body.source === "string" ? body.source.trim() : ""
  if (!name) return fail("请填写摄像头名称", 400, "NAME_REQUIRED")

  const sourceError = validateSourceUrl(source)
  if (sourceError) return fail(sourceError, 400, "SOURCE_INVALID")
  if (isBlockedHost(new URL(source).hostname)) return fail("该地址属于云元数据保留网段，已拒绝", 400, "SOURCE_BLOCKED")

  const streams = loadStreams()
  const requestedId = typeof body.id === "string" ? body.id.trim() : ""
  const id = requestedId || slugifyStreamId(name)
  if (!STREAM_ID_PATTERN.test(id) || RESERVED_STREAM_IDS.includes(id)) {
    return fail("通道 ID 只能包含字母、数字、下划线和连字符（最多 48 位）", 400, "ID_INVALID")
  }
  if (streams.some((stream) => stream.id === id)) return fail(`通道 ID ${id} 已存在`, 409, "ID_CONFLICT")

  const meta: StreamMeta = {
    id,
    name,
    zone,
    source,
    builtin: false,
    autoPatrol: false,
    createdAt: new Date().toISOString(),
  }
  writeStreams([...streams, meta])

  let warning: string | undefined
  try {
    await registerStream(meta)
  } catch (error) {
    warning = error instanceof Error ? error.message : "通道已保存，但注册到引擎失败"
  }

  return NextResponse.json({ ...(await getStreamViews()), created: id, warning }, { status: 201 })
}
