import { CircleCheck, Clock, Siren } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { SEVERITY_LABEL } from "@/lib/vigil/rules"
import type { ChunkProgress, Severity, VideoStatus } from "@/lib/vigil/types"

const STATUS_STYLE: Record<VideoStatus, string> = {
  pending: "border-border bg-secondary text-muted-foreground",
  analyzing: "border-primary/40 bg-primary/10 text-primary",
  safe: "border-success/40 bg-success/10 text-success",
  alert: "border-destructive/50 bg-destructive/10 text-destructive",
}

export function chunkProgressLabel(progress: ChunkProgress) {
  return `切片 ${progress.index}/${progress.total} (${progress.percent}%)`
}

export function VideoStatusBadge({ status, progress }: { status: VideoStatus; progress?: ChunkProgress }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5", STATUS_STYLE[status])}>
      {status === "pending" && (
        <>
          <Clock aria-hidden="true" />
          待分析
        </>
      )}
      {status === "analyzing" && (
        <>
          <Spinner aria-hidden="true" />
          {progress ? chunkProgressLabel(progress) : "推理中..."}
        </>
      )}
      {status === "safe" && (
        <>
          <CircleCheck aria-hidden="true" />
          正常安全
        </>
      )}
      {status === "alert" && (
        <>
          <Siren aria-hidden="true" />
          触发预警
        </>
      )}
    </Badge>
  )
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        severity === "CRITICAL" && "border-destructive/50 bg-destructive/15 text-destructive",
        severity === "WARNING" && "border-warning/50 bg-warning/15 text-warning",
        severity === "INFO" && "border-primary/40 bg-primary/10 text-primary"
      )}
    >
      {SEVERITY_LABEL[severity]}
    </Badge>
  )
}
