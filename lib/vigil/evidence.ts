import { formatClock, type MotionSegment } from "@/lib/client/frame-capture"
import type { VlmFinalResult, VlmKeyframeInput } from "@/lib/ops/vlm-api-types"

export interface EvidenceChain {
  /** 违规时间码，如 "00:16" */
  timestamp: string
  /** 完整的 data:image/jpeg;base64,...，没有像素帧时为空 */
  frameBase64?: string
  /** 证据帧是本次送检的第几张采样帧（从 1 起） */
  frameIndex?: number
  frameTotal: number
  /** 证据帧所属的动作区间，如 "00:11 - 00:21" */
  motionSegment?: string
}

const OFFSET = /^(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/

function offsetSeconds(offset: string) {
  const match = OFFSET.exec(offset.trim())
  if (!match) return 0
  const [, minutes, seconds, millis = "0"] = match
  return Number(minutes) * 60 + Number(seconds) + Number(millis.padEnd(3, "0")) / 1000
}

/**
 * 把模型判定的证据锚点还原成可存档的证据链。
 * 像素在客户端本来就有，按 evidenceKeyframes 的帧编号回查即可，不必让服务端把 Base64 再回传一遍。
 */
export function buildEvidenceChain(
  result: VlmFinalResult,
  frames: VlmKeyframeInput[],
  segments: MotionSegment[] = []
): EvidenceChain {
  const evidenceIndex = result.evidenceKeyframes[0]
  const frame = frames.find((f) => f.index === evidenceIndex)
  const seconds = frame?.timestampSec ?? offsetSeconds(result.timestampOffset)
  const segment = segments.find((s) => seconds >= s.startSeconds - 0.5 && seconds <= s.endSeconds + 0.5)
  const image = frame?.imageUrl?.startsWith("data:image/") ? frame.imageUrl : undefined

  return {
    timestamp: frame?.timecode ?? formatClock(seconds),
    frameBase64: image,
    frameIndex: frame ? frames.indexOf(frame) + 1 : undefined,
    frameTotal: frames.length,
    motionSegment: segment ? `${segment.start} - ${segment.end}` : undefined,
  }
}
