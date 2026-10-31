import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"

import { PathGuardError, resolveSafePath } from "@/lib/ops/server/path-guard"
import { formatBytes, formatClock, readVideoMeta } from "@/lib/ops/server/video-meta"
import {
  DEFAULT_VIDEO_EXTENSIONS,
  type ScanFolderRequest,
  type ScanFolderResponse,
  type ScannedVideoItem,
  type VideoApiError,
} from "@/lib/ops/video-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_DEPTH = 3
const MAX_VIDEOS = 100
const EXTENSION_PATTERN = /^\.[a-z0-9]{1,5}$/

function fail(status: number, message: string) {
  return NextResponse.json<VideoApiError>({ status: "error", message }, { status })
}

function normalizeExtensions(input: unknown): Set<string> | null {
  if (input === undefined) return new Set(DEFAULT_VIDEO_EXTENSIONS)
  if (!Array.isArray(input) || input.length === 0 || input.length > 20) return null
  const out = new Set<string>()
  for (const item of input) {
    if (typeof item !== "string") return null
    const ext = (item.startsWith(".") ? item : `.${item}`).toLowerCase()
    if (!EXTENSION_PATTERN.test(ext)) return null
    out.add(ext)
  }
  return out
}

interface WalkState {
  videos: ScannedVideoItem[]
  truncated: boolean
}

async function walk(dir: string, depth: number, recursive: boolean, extensions: Set<string>, state: WalkState) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    if (state.truncated) return
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue

    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (recursive && depth < MAX_DEPTH && entry.name !== "node_modules") {
        await walk(full, depth + 1, recursive, extensions, state)
      }
      continue
    }
    if (!entry.isFile()) continue

    const ext = path.extname(entry.name).toLowerCase()
    if (!extensions.has(ext)) continue
    if (state.videos.length >= MAX_VIDEOS) {
      state.truncated = true
      return
    }

    let stat
    try {
      stat = await fs.stat(full)
    } catch {
      continue
    }
    const meta = await readVideoMeta(full, ext, stat)
    const id = createHash("sha1").update(`${full}|${stat.size}|${stat.mtimeMs}`).digest("hex").slice(0, 12)

    state.videos.push({
      id: `disk-${id}`,
      name: entry.name,
      path: full,
      sizeBytes: stat.size,
      sizeFormatted: formatBytes(stat.size),
      duration: formatClock(meta.durationSeconds),
      durationSeconds: meta.durationSeconds,
      durationSource: meta.durationSource,
      format: ext.slice(1).toUpperCase(),
      resolution: meta.resolution,
      status: "pending",
      lastModified: stat.mtime.toISOString(),
    })
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<ScanFolderRequest> | null
  if (!body || typeof body !== "object") return fail(400, "请求体必须是 JSON 对象")

  const extensions = normalizeExtensions(body.filterExtensions)
  if (!extensions) return fail(400, "filterExtensions 必须是形如 [\".mp4\"] 的扩展名数组")
  if (body.recursive !== undefined && typeof body.recursive !== "boolean") {
    return fail(400, "recursive 必须是布尔值")
  }

  try {
    const { resolved } = await resolveSafePath(body.folderPath, "dir")
    const state: WalkState = { videos: [], truncated: false }
    await walk(resolved, 0, body.recursive === true, extensions, state)

    return NextResponse.json<ScanFolderResponse>({
      status: "success",
      folderPath: resolved,
      totalFound: state.videos.length,
      truncated: state.truncated,
      scannedAt: new Date().toISOString(),
      videos: state.videos,
    })
  } catch (error) {
    if (error instanceof PathGuardError) return fail(error.httpStatus, error.message)
    return fail(500, "服务端扫描目录时发生异常")
  }
}
