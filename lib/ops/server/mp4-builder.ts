import { createHash } from "node:crypto"

const TIMESCALE = 1000
const IDENTITY_MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]

export interface Mp4Spec {
  durationSec: number
  width: number
  height: number
  sizeBytes: number
  seed: string
}

function box(type: string, ...payload: Buffer[]) {
  const body = Buffer.concat(payload)
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + body.length, 0)
  header.write(type, 4, "latin1")
  return Buffer.concat([header, body])
}

function ftyp() {
  const body = Buffer.alloc(8)
  body.write("isom", 0, "latin1")
  body.writeUInt32BE(512, 4)
  return box("ftyp", body, Buffer.from("isomiso2mp41", "latin1"))
}

function mvhd(durationSec: number) {
  const body = Buffer.alloc(100)
  body.writeUInt32BE(TIMESCALE, 12)
  body.writeUInt32BE(Math.round(durationSec * TIMESCALE), 16)
  body.writeUInt32BE(0x00010000, 20)
  body.writeUInt16BE(0x0100, 24)
  IDENTITY_MATRIX.forEach((value, i) => body.writeUInt32BE(value, 36 + i * 4))
  body.writeUInt32BE(2, 96)
  return box("mvhd", body)
}

function tkhd(durationSec: number, width: number, height: number) {
  const body = Buffer.alloc(84)
  body.writeUInt32BE(0x00000003, 0)
  body.writeUInt32BE(1, 12)
  body.writeUInt32BE(Math.round(durationSec * TIMESCALE), 20)
  IDENTITY_MATRIX.forEach((value, i) => body.writeUInt32BE(value, 40 + i * 4))
  body.writeUInt32BE(width * 65536, 76)
  body.writeUInt32BE(height * 65536, 80)
  return box("tkhd", body)
}

function mediaPayload(sizeBytes: number, seed: string) {
  const out = Buffer.alloc(sizeBytes)
  let block = createHash("sha256").update(seed).digest()
  for (let offset = 0; offset < sizeBytes; offset += block.length) {
    block.copy(out, offset, 0, Math.min(block.length, sizeBytes - offset))
    block = createHash("sha256").update(block).digest()
  }
  return out
}

/**
 * 生成带有真实 ISO-BMFF 头部（ftyp + moov{mvhd, trak{tkhd}} + mdat）的 mp4 文件。
 * 时长与分辨率可被 readVideoMeta 直接解析；mdat 为确定性填充数据，不是可播放的 H.264 码流。
 */
export function buildMp4(spec: Mp4Spec): Buffer {
  const moov = box("moov", mvhd(spec.durationSec), box("trak", tkhd(spec.durationSec, spec.width, spec.height)))
  return Buffer.concat([ftyp(), moov, box("mdat", mediaPayload(spec.sizeBytes, spec.seed))])
}
