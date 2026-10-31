import { createReadStream } from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import type { NextRequest } from "next/server"

import { PathGuardError } from "@/lib/ops/server/path-guard"
import { buildVideoCandidates, locateVideo } from "@/lib/ops/server/video-locator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
}

function failure(status: number, message: string, headers?: HeadersInit) {
  return Response.json({ status: "error", message }, { status, headers })
}

type ByteRange = { start: number; end: number } | "unsatisfiable"

function parseRange(header: string, size: number): ByteRange {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === "" && match[2] === "")) return "unsatisfiable"

  if (match[1] === "") {
    // bytes=-N 表示最后 N 个字节
    const suffix = Number(match[2])
    if (suffix === 0) return "unsatisfiable"
    return { start: Math.max(size - suffix, 0), end: size - 1 }
  }

  const start = Number(match[1])
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1)
  if (start >= size || start > end) return "unsatisfiable"
  return { start, end }
}

/**
 * GET /api/v1/videos/stream?path=<绝对路径 | 相对路径 | 纯文件名>
 *
 * 以 HTTP Range（206 Partial Content）流式输出磁盘视频，让 <video> 可以拖动进度条、分段缓冲。
 * 路径先经 video-locator 按优先级智能补全（绝对路径 → 工程根目录 → vidso → public/videos →
 * VIGIL_ALLOWED_ROOTS / VIGIL_SCAN_DIR），每个候选都经 path-guard 校验：只允许项目根目录、
 * 系统临时目录以及环境变量追加的目录，并在 realpath 之后再校验一次以防符号链接逃逸。
 */
export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") ?? ""

  let safe: Awaited<ReturnType<typeof locateVideo>>
  try {
    safe = await locateVideo(requestedPath)
  } catch (error) {
    const tried = requestedPath.trim() ? buildVideoCandidates(requestedPath.trim())[0] : "(空)"
    const reason = error instanceof Error ? error.message : "未知错误"
    console.log("[VIDEO_STREAM] 请求路径:", requestedPath, "→ 解析物理路径:", tried, "文件是否存在:", false, "| 原因:", reason)
    if (error instanceof PathGuardError) return failure(error.httpStatus, error.message)
    return failure(500, "视频文件读取失败")
  }
  console.log("[VIDEO_STREAM] 请求路径:", requestedPath, "→ 解析物理路径:", safe.resolved, "文件是否存在:", true)

  const contentType = MIME_BY_EXT[path.extname(safe.resolved).toLowerCase()]
  if (!contentType) return failure(415, "不支持在线播放该视频格式")

  const size = safe.stat.size
  const baseHeaders = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  }

  if (size === 0) {
    return new Response(null, { status: 200, headers: { ...baseHeaders, "Content-Length": "0" } })
  }

  const rangeHeader = request.headers.get("range")
  const range = rangeHeader ? parseRange(rangeHeader, size) : { start: 0, end: size - 1 }

  if (range === "unsatisfiable") {
    return failure(416, "请求的字节范围无效", { "Content-Range": `bytes */${size}` })
  }

  const stream = Readable.toWeb(
    createReadStream(safe.resolved, { start: range.start, end: range.end })
  ) as ReadableStream<Uint8Array>

  const partial = rangeHeader !== null
  return new Response(stream, {
    status: partial ? 206 : 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(range.end - range.start + 1),
      ...(partial ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
    },
  })
}
