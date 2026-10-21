import { ImageOff, Timer } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface EvidenceFrameProps {
  src?: string
  alt: string
  variant: "thumb" | "full"
  className?: string
}

/** 违规抓拍帧；老记录或服务端抽帧没有像素时降级为占位，不影响布局。 */
export function EvidenceFrame({ src, alt, variant, className }: EvidenceFrameProps) {
  const frame = "overflow-hidden rounded-lg border border-border bg-secondary"

  if (!src) {
    return (
      <div
        role="img"
        aria-label="无证据帧"
        className={cn(
          frame,
          "flex flex-col items-center justify-center gap-1.5 border-dashed text-xs text-muted-foreground",
          variant === "thumb" ? "aspect-video w-full" : "h-40 w-full",
          className
        )}
      >
        <ImageOff className="size-5" aria-hidden="true" />
        无证据帧（仅时序元数据）
      </div>
    )
  }

  return (
    <div className={cn(frame, variant === "thumb" ? "aspect-video w-full" : "w-full", className)}>
      <img
        src={src}
        alt={alt}
        className={cn("w-full", variant === "thumb" ? "h-full object-cover" : "max-h-80 object-contain")}
      />
    </div>
  )
}

export function TimestampBadge({ timestamp, className }: { timestamp: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 border-destructive/40 bg-destructive/10 font-mono text-destructive", className)}
    >
      <Timer aria-hidden="true" />
      {timestamp} 处
    </Badge>
  )
}
