import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  PROTOCOL_LABEL,
  type StreamProtocol,
  type StreamStatus,
} from "@/lib/ops/ingestion-types"

const PROTOCOL_STYLE: Record<StreamProtocol, string> = {
  RTSP: "border-primary/40 bg-primary/10 text-primary",
  RTMP: "border-warning/40 bg-warning/10 text-warning",
  GB28181: "border-signal/40 bg-signal/10 text-signal",
  WebRTC: "border-success/40 bg-success/10 text-success",
  FILE: "border-border bg-secondary text-muted-foreground",
}

export function ProtocolBadge({ protocol }: { protocol: StreamProtocol }) {
  return (
    <Badge variant="outline" className={cn("font-mono", PROTOCOL_STYLE[protocol])}>
      {PROTOCOL_LABEL[protocol]}
    </Badge>
  )
}

const STATUS_META: Record<StreamStatus, { label: string; dot: string; text: string }> = {
  connected: { label: "已连接", dot: "bg-success", text: "text-success" },
  frame_drop: { label: "丢帧", dot: "bg-warning", text: "text-warning" },
  offline: { label: "离线", dot: "bg-destructive", text: "text-destructive" },
}

export function StreamStatusBadge({ status }: { status: StreamStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium", meta.text)}
      role="status"
    >
      <span className="relative flex size-2">
        {status !== "offline" && (
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-60",
              meta.dot,
            )}
          />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", meta.dot)} />
      </span>
      {meta.label}
    </span>
  )
}
