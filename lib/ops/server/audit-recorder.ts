import { randomUUID } from "node:crypto"

import { upsertAuditRecords } from "@/lib/storage/audit-store"
import { loadVisionConfig } from "@/lib/storage/vision-store"
import type { AuditTier2Record } from "@/lib/vigil/audit"

export type Tier2AuditInput = Omit<AuditTier2Record, "kind" | "id" | "at"> & { at?: string }

/** 链路审计模式开启时，把二级研判的完整结论（含放行 / 拦截的推理论据）落盘；关闭时零开销。 */
export function recordTier2Audit(input: Tier2AuditInput) {
  try {
    if (!loadVisionConfig().auditMode) return
    upsertAuditRecords([
      {
        ...input,
        kind: "tier2",
        id: randomUUID().slice(0, 12),
        at: input.at ?? new Date().toISOString(),
        reasoning: input.reasoning.slice(0, 4000),
        summary: input.summary.slice(0, 600),
      },
    ])
  } catch (error) {
    console.error("[audit] 写入二级审计失败：", error)
  }
}
