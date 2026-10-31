import { promises as fs, type Stats } from "node:fs"
import type { FileHandle } from "node:fs/promises"

export interface VideoMeta {
  durationSeconds: number
  durationSource: "header" | "estimated"
  resolution: string | null
}

const MOOV_READ_CAP = 1024 * 1024
const ESTIMATED_BYTES_PER_SECOND = 500_000
const MAX_DURATION_SEC = 24 * 3600

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function formatClock(totalSec: number) {
  const whole = Math.max(0, Math.round(totalSec))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function resolutionLabel(width: number, height: number) {
  if (!width || !height) return null
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (short >= 2160 || long >= 3840) return "4K"
  if (short >= 1440) return "1440P"
  if (short >= 1080) return "1080P"
  if (short >= 720) return "720P"
  return `${short}P`
}

interface ParsedHeader {
  durationSeconds: number
  width: number
  height: number
}

function parseTkhd(data: Buffer): { width: number; height: number } | null {
  if (data.length < 4) return null
  const version = data[0]
  const widthOffset = version === 1 ? 88 : 76
  if (data.length < widthOffset + 8) return null
  return {
    width: data.readUInt32BE(widthOffset) / 65536,
    height: data.readUInt32BE(widthOffset + 4) / 65536,
  }
}

function parseMoov(body: Buffer): ParsedHeader | null {
  let durationSeconds = 0
  let width = 0
  let height = 0

  const walk = (buf: Buffer, start: number, end: number, inTrak: boolean) => {
    let pos = start
    while (pos + 8 <= end) {
      const size = buf.readUInt32BE(pos)
      const type = buf.toString("latin1", pos + 4, pos + 8)
      if (size < 8 || pos + size > end) return
      const dataStart = pos + 8
      const dataEnd = pos + size

      if (type === "mvhd" && !inTrak && durationSeconds === 0) {
        const version = buf[dataStart]
        if (version === 1 && dataEnd - dataStart >= 32) {
          const timescale = buf.readUInt32BE(dataStart + 20)
          const duration = Number(buf.readBigUInt64BE(dataStart + 24))
          if (timescale > 0) durationSeconds = duration / timescale
        } else if (version === 0 && dataEnd - dataStart >= 20) {
          const timescale = buf.readUInt32BE(dataStart + 12)
          const duration = buf.readUInt32BE(dataStart + 16)
          if (timescale > 0) durationSeconds = duration / timescale
        }
      } else if (type === "trak") {
        walk(buf, dataStart, dataEnd, true)
      } else if (type === "tkhd" && inTrak && width === 0) {
        const dims = parseTkhd(buf.subarray(dataStart, dataEnd))
        if (dims && dims.width > 0 && dims.height > 0) {
          width = dims.width
          height = dims.height
        }
      }
      pos += size
    }
  }

  walk(body, 0, body.length, false)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  return { durationSeconds, width, height }
}

async function parseIsoBmff(handle: FileHandle, fileSize: number): Promise<ParsedHeader | null> {
  const header = Buffer.alloc(16)
  let offset = 0
  for (let guard = 0; guard < 64 && offset + 8 <= fileSize; guard += 1) {
    const { bytesRead } = await handle.read(header, 0, 16, offset)
    if (bytesRead < 8) return null

    let boxSize = header.readUInt32BE(0)
    const type = header.toString("latin1", 4, 8)
    let headerLength = 8
    if (boxSize === 1 && bytesRead >= 16) {
      boxSize = Number(header.readBigUInt64BE(8))
      headerLength = 16
    } else if (boxSize === 0) {
      boxSize = fileSize - offset
    }
    if (boxSize < headerLength) return null

    if (type === "moov") {
      const bodyLength = Math.min(boxSize - headerLength, MOOV_READ_CAP)
      const body = Buffer.alloc(bodyLength)
      const read = await handle.read(body, 0, bodyLength, offset + headerLength)
      return parseMoov(body.subarray(0, read.bytesRead))
    }
    offset += boxSize
  }
  return null
}

async function parseAvi(handle: FileHandle): Promise<ParsedHeader | null> {
  const buf = Buffer.alloc(72)
  const { bytesRead } = await handle.read(buf, 0, 72, 0)
  if (bytesRead < 72) return null
  if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "AVI ") return null
  if (buf.toString("latin1", 24, 28) !== "avih") return null
  const microSecPerFrame = buf.readUInt32LE(32)
  const totalFrames = buf.readUInt32LE(48)
  const durationSeconds = (microSecPerFrame * totalFrames) / 1e6
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  return { durationSeconds, width: buf.readUInt32LE(64), height: buf.readUInt32LE(68) }
}

function estimate(stat: Pick<Stats, "size">): VideoMeta {
  const seconds = Math.min(MAX_DURATION_SEC, Math.max(1, Math.round(stat.size / ESTIMATED_BYTES_PER_SECOND)))
  return { durationSeconds: seconds, durationSource: "estimated", resolution: null }
}

/** 仅依赖 Node 内置 fs：MP4/MOV 读取 moov，AVI 读取 avih，其余格式按大小估算。 */
export async function readVideoMeta(filePath: string, ext: string, stat: Pick<Stats, "size">): Promise<VideoMeta> {
  const lower = ext.toLowerCase()
  const supportsHeader = lower === ".mp4" || lower === ".mov" || lower === ".avi"
  if (!supportsHeader) return estimate(stat)

  let handle: FileHandle | undefined
  try {
    handle = await fs.open(filePath, "r")
    const parsed =
      lower === ".avi" ? await parseAvi(handle) : await parseIsoBmff(handle, stat.size)
    if (!parsed) return estimate(stat)
    return {
      durationSeconds: Math.min(MAX_DURATION_SEC, parsed.durationSeconds),
      durationSource: "header",
      resolution: resolutionLabel(parsed.width, parsed.height),
    }
  } catch {
    return estimate(stat)
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
