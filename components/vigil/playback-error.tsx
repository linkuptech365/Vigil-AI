import { ExternalLink, VideoOff } from "lucide-react"

import type { PlaybackFailure } from "@/lib/vigil/playback-diagnosis"

interface PlaybackErrorProps {
  /** 无可播放来源（如刷新后丢失的本机 Blob）时为 null。 */
  src: string | null
  failure: PlaybackFailure | null
}

export function PlaybackError({ src, failure }: PlaybackErrorProps) {
  const message = failure?.message ?? (src ? "正在诊断播放失败原因..." : "无可播放画面（仅元数据）")
  const code = failure?.mediaErrorCode
  const status = failure?.httpStatus

  return (
    <div
      role="alert"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 px-3 text-center text-muted-foreground"
    >
      <VideoOff className="size-5" aria-hidden="true" />
      <span className="text-pretty text-xs leading-relaxed">{message}</span>
      {(status || code) && (
        <span className="font-mono text-[10px]">
          {status ? `HTTP ${status}` : null}
          {status && code ? " · " : null}
          {code ? `MEDIA_ERR ${code}` : null}
        </span>
      )}
      {src?.startsWith("/api/") && (
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded border border-border bg-black/50 px-1.5 py-0.5 text-[10px] text-foreground outline-none transition-colors hover:border-signal/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink className="size-3" aria-hidden="true" />
          在新标签页直接测试视频流
        </a>
      )}
    </div>
  )
}
