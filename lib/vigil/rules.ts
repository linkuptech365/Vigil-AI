import type { RuleSeverity } from "@/lib/ops/rules-types"

export const SEVERITY_LABEL: Record<RuleSeverity, string> = {
  CRITICAL: "严重",
  WARNING: "警告",
  INFO: "提示",
}

/** 兼容缺少等级快照的历史队列数据 */
export function normalizeSeverity(value: unknown): RuleSeverity {
  return value === "CRITICAL" || value === "WARNING" || value === "INFO" ? value : "WARNING"
}
