import { NextResponse } from "next/server"

import { getStream, loadStreams, patchStream, removeAlertsOfStream, writeStreams } from "@/lib/storage/streams-store"
import { getStreamViews, unregisterStream } from "@/lib/stream-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Params = { params: Promise<{ streamId: string }> }

function fail(message: string, status: number, code: string) {
  return NextResponse.json({ status: "error", message, error: code }, { status })
}

export async function PATCH(request: Request, { params }: Params) {
  const { streamId } = await params
  const body = (await request.json().catch(() => ({}))) as { autoPatrol?: unknown }
  if (!getStream(streamId)) return fail(`通道 ${streamId} 不存在`, 404, "STREAM_NOT_FOUND")
  if (typeof body.autoPatrol !== "boolean") return fail("autoPatrol 必须是布尔值", 400, "BAD_BODY")
  patchStream(streamId, { autoPatrol: body.autoPatrol })
  return NextResponse.json(await getStreamViews())
}

export async function DELETE(_request: Request, { params }: Params) {
  const { streamId } = await params
  const meta = getStream(streamId)
  if (!meta) return fail(`通道 ${streamId} 不存在`, 404, "STREAM_NOT_FOUND")
  if (meta.builtin) return fail("内置模拟流不可删除", 400, "BUILTIN_PROTECTED")

  writeStreams(loadStreams().filter((stream) => stream.id !== streamId))
  removeAlertsOfStream(streamId)
  await unregisterStream(streamId)
  return NextResponse.json(await getStreamViews())
}
