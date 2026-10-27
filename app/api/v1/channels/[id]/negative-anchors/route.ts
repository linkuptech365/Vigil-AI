import { NextResponse } from "next/server"

import { addNegativeAnchor, getStream, MAX_NEGATIVE_ANCHORS, parseNormalizedBbox, removeNegativeAnchor } from "@/lib/storage/streams-store"
import { pushConfig } from "@/lib/vision-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

const MAX_LABEL_LENGTH = 60

function fail(message: string, status: number, code: string) {
  return NextResponse.json({ status: "error", message, error: code }, { status, headers: { "Cache-Control": "no-store" } })
}

/** 锚点已落盘；热更新失败不回滚，Worker 恢复后下一次配置推送会带上最新锚点。 */
async function syncWorker() {
  try {
    const result = await pushConfig()
    return result ? { pushed: true, ok: result.ok, message: result.message } : { pushed: false, ok: true, message: "Worker 未就绪或配置无变化，未推送" }
  } catch (error) {
    return { pushed: false, ok: false, message: error instanceof Error ? error.message : "推送配置失败" }
  }
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  const stream = getStream(id)
  if (!stream) return fail(`通道 ${id} 不存在`, 404, "STREAM_NOT_FOUND")
  return NextResponse.json({ anchors: stream.negativeAnchors ?? [], limit: MAX_NEGATIVE_ANCHORS }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { label?: unknown; bbox?: unknown } | null
  if (!body || typeof body !== "object") return fail("请求体必须是 JSON 对象", 400, "BAD_BODY")

  const label = typeof body.label === "string" ? body.label.trim() : ""
  if (!label || label.length > MAX_LABEL_LENGTH) return fail(`label 必填且不超过 ${MAX_LABEL_LENGTH} 个字符`, 400, "BAD_LABEL")
  const bbox = parseNormalizedBbox(body.bbox)
  if (!bbox) return fail("bbox 必须是 [ymin, xmin, ymax, xmax]，取值 0~1 且 min < max", 400, "BAD_BBOX")

  const result = addNegativeAnchor(id, { label, bbox })
  if (!result.ok) {
    return result.reason === "STREAM_NOT_FOUND"
      ? fail(`通道 ${id} 不存在`, 404, "STREAM_NOT_FOUND")
      : fail(`每个通道最多保存 ${MAX_NEGATIVE_ANCHORS} 个负样本锚点`, 409, "LIMIT_REACHED")
  }
  const worker = await syncWorker()
  return NextResponse.json({ anchor: result.anchor, anchors: result.anchors, worker }, { status: 201, headers: { "Cache-Control": "no-store" } })
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { anchorId?: unknown } | null
  const fromQuery = new URL(request.url).searchParams.get("anchorId")
  const anchorId = typeof body?.anchorId === "string" ? body.anchorId : fromQuery
  if (!anchorId) return fail("缺少 anchorId", 400, "BAD_BODY")

  const result = removeNegativeAnchor(id, anchorId)
  if (!result) return fail(`通道 ${id} 不存在`, 404, "STREAM_NOT_FOUND")
  if (!result.removed) return fail(`负样本锚点 ${anchorId} 不存在`, 404, "ANCHOR_NOT_FOUND")
  const worker = await syncWorker()
  return NextResponse.json({ anchors: result.anchors, worker }, { headers: { "Cache-Control": "no-store" } })
}
