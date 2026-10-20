import { Badge } from "@/components/ui/badge"
import {
  CAPA_STATUS_ENGLISH,
  CAPA_STATUS_LABEL,
  CLASSIFICATION_LABEL,
  type CapaStatus,
  type DeviationClass,
} from "@/lib/ops/audit-types"
import { cn } from "@/lib/utils"

const CLASS_STYLE: Record<DeviationClass, string> = {
  CRITICAL: "border-destructive/50 bg-destructive/15 text-destructive",
  MAJOR: "border-warning/50 bg-warning/15 text-warning",
  MINOR: "border-signal/40 bg-signal/10 text-signal",
}

const STATUS_STYLE: Record<CapaStatus, string> = {
  DRAFT: "border-border bg-secondary text-muted-foreground",
  IN_PROGRESS: "border-warning/50 bg-warning/15 text-warning",
  QA_REVIEW: "border-signal/40 bg-signal/10 text-signal",
  APPROVED: "border-success/50 bg-success/15 text-success",
}

export function ClassificationBadge({ value }: { value: DeviationClass }) {
  return (
    <Badge variant="outline" className={cn("font-mono", CLASS_STYLE[value])} title={CLASSIFICATION_LABEL[value]}>
      {value}
    </Badge>
  )
}

export function CapaStatusBadge({ value }: { value: CapaStatus }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", STATUS_STYLE[value])} title={CAPA_STATUS_ENGLISH[value]}>
      {CAPA_STATUS_LABEL[value]}
    </Badge>
  )
}
