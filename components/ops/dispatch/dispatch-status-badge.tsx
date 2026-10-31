import { Badge } from "@/components/ui/badge"
import { STATUS_ENGLISH, STATUS_SHORT_LABEL } from "@/lib/ops/dispatch-data"
import type { DossierStatus } from "@/lib/ops/dispatch-types"
import { cn } from "@/lib/utils"

const STATUS_STYLE: Record<DossierStatus, string> = {
  PENDING: "border-destructive/50 bg-destructive/10 text-destructive",
  DISPATCHED: "border-warning/50 bg-warning/10 text-warning",
  IN_PROGRESS: "border-signal/50 bg-signal/10 text-signal",
  RESOLVED: "border-success/50 bg-success/10 text-success",
  FALSE_POSITIVE: "border-input bg-secondary text-muted-foreground",
}

export function DispatchStatusBadge({
  status,
  className,
}: {
  status: DossierStatus
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn(STATUS_STYLE[status], className)}>
      {STATUS_SHORT_LABEL[status]} ({STATUS_ENGLISH[status]})
    </Badge>
  )
}
