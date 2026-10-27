import { NextResponse } from "next/server"

import { analyzeStream, StreamAnalysisError } from "@/lib/ops/server/stream-analysis"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const MAX_EVIDENCE_FRAMES = 6
const MAX_FRAME_BYTES = 4_000_000

/**
 * 历史切片可以是 Base64 / data URL，也可以是本站的图片 URL（相对路径或同 host）。
 * 只允许同源 URL，避免接口被当作任意地址的服务端请求代理（SSRF）。
 */
async function resolveEvidenceFrame(raw: string, request: Request): Promise<string | null> {
  const value = raw.trim()
  if (!value) return null
  if (value.startsWith("data:")) return value
  if (!/^(https?:\/\/|\/)/i.test(value)) return value

  let url: URL
  try {
    url = new URL(value, request.url)
  } catch {
    return null
  }
  const allowedHosts = new Set([new URL(request.url).host, request.headers.get("host") ?? ""])
  if (!allowedHosts.has(url.host)) return null

  try {
    const response = await fetch(url, { signal: request.signal, cache: "no-store" })
    if (!response.ok) return null
    const type = response.headers.get("content-type") ?? ""
    if (!type.startsWith("image/")) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0 || buffer.length > MAX_FRAME_BYTES) return null
    return buffer.toString("base64")
  } catch {
    return null
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ streamId: string }> }) {
  const { streamId } = await params
  const body = (await request.json().catch(() => ({}))) as { modelProfileId?: unknown; frameCount?: unknown; evidenceFrames?: unknown }

  let providedFrames: string[] | undefined
  if (body.evidenceFrames !== undefined) {
    const requested = Array.isArray(body.evidenceFrames) ? body.evidenceFrames.filter((item): item is string => typeof item === "string") : []
    const resolved = (await Promise.all(requested.slice(0, MAX_EVIDENCE_FRAMES).map((item) => resolveEvidenceFrame(item, request)))).filter(
      (item): item is string => item !== null
    )
    // 显式传入了 evidenceFrames 就不再回落到实时抓帧，避免对错误画面送审并消耗 Token
    if (resolved.length === 0) {
      return NextResponse.json({ status: "error", message: "evidenceFrames 中没有可用的图片（支持 Base64、data URL 或同源图片 URL）", error: "NO_VALID_IMAGE_FRAMES" }, { status: 400 })
    }
    providedFrames = resolved
  }

  try {
    const outcome = await analyzeStream({
      streamId,
      source: "stream",
      trigger: "manual",
      frameCount: typeof body.frameCount === "number" ? body.frameCount : 4,
      providedFrames,
      modelProfileId: typeof body.modelProfileId === "string" ? body.modelProfileId : undefined,
      requestHost: request.headers.get("host"),
      signal: request.signal,
    })
    const { verdictDetail: _verdict, result: _result, ...payload } = outcome
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof StreamAnalysisError) {
      return NextResponse.json({ status: "error", message: error.message, error: error.code }, { status: error.status })
    }
    console.error("[stream-analyze]", error)
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : "研判失败", error: "INTERNAL" }, { status: 500 })
  }
}
