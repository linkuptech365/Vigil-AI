export interface PlaybackFailure {
  /** 展示给用户的具体原因。 */
  message: string
  /** 探测流地址得到的 HTTP 状态；Blob 地址或网络不可达时为 null。 */
  httpStatus: number | null
  /** HTMLMediaElement.error.code：1=ABORTED 2=NETWORK 3=DECODE 4=SRC_NOT_SUPPORTED。 */
  mediaErrorCode: number | null
}

export const MEDIA_ERROR_CODE_LABEL: Record<number, string> = {
  1: "ABORTED",
  2: "NETWORK",
  3: "DECODE",
  4: "SRC_NOT_SUPPORTED",
}

const UNREADABLE = "无法读取视频源文件 (请检查目录路径或权限)"
const UNSUPPORTED_CODEC = "浏览器不支持该视频编码 (可能是 H.265/HEVC，建议转为 H.264)"

function messageForMediaError(code: number | null): string {
  if (code === 2) return "视频流加载中断 (网络错误)"
  if (code === 3) return UNSUPPORTED_CODEC
  if (code === 4) return "浏览器无法解析该视频 (封装或编码不受支持，建议转为 H.264 MP4)"
  return code ? `解码/加载失败 (代码 ${code})` : "无法获取视频流"
}

/** <video> 的 error 事件本身分不清「404/403」与「编码不支持」，这里再用 Range 请求探测一次真实状态。 */
async function probeStatus(src: string): Promise<number | null> {
  if (!src.startsWith("/api/")) return null
  try {
    const response = await fetch(src, { headers: { Range: "bytes=0-0" }, cache: "no-store" })
    void response.body?.cancel()
    return response.status
  } catch {
    return 0
  }
}

export async function diagnosePlaybackFailure(
  src: string,
  mediaErrorCode: number | null
): Promise<PlaybackFailure> {
  const httpStatus = await probeStatus(src)

  if (httpStatus === 0) {
    return { message: "无法获取视频流", httpStatus: null, mediaErrorCode }
  }
  if (httpStatus === 403 || httpStatus === 404) {
    return { message: UNREADABLE, httpStatus, mediaErrorCode }
  }
  if (httpStatus === 415) {
    return { message: "不支持在线播放该视频格式", httpStatus, mediaErrorCode }
  }
  if (httpStatus !== null && httpStatus >= 400) {
    return { message: `视频流服务异常 (HTTP ${httpStatus})`, httpStatus, mediaErrorCode }
  }
  return { message: messageForMediaError(mediaErrorCode), httpStatus, mediaErrorCode }
}
