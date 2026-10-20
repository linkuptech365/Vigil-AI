"use client"

import * as React from "react"

import {
  getAuditSnapshot,
  getServerAuditSnapshot,
  subscribeAudit,
} from "@/lib/ops/storage/audit-storage"

export function useAuditStore() {
  return React.useSyncExternalStore(subscribeAudit, getAuditSnapshot, getServerAuditSnapshot)
}
