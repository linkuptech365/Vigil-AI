"use client"

import * as React from "react"
import { ClipboardCheck, FileSearch, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  CAPA_STATUS_ENGLISH,
  CAPA_STATUS_LABEL,
  CLASSIFICATION_LABEL,
  type CapaStatus,
  type DeviationClass,
} from "@/lib/ops/audit-types"
import { createEmptyCapa } from "@/lib/ops/storage/audit-storage"
import { useOps } from "../ops-provider"
import { CapaStatusBadge, ClassificationBadge } from "./audit-badges"
import { CapaModal } from "./capa-modal"
import { DossierDialog } from "./dossier-dialog"
import { useAuditStore } from "./use-audit-store"

const CLASS_ENGLISH: Record<DeviationClass, string> = {
  CRITICAL: "Critical",
  MAJOR: "Major",
  MINOR: "Minor",
}

export function AuditTrailView() {
  const { auditOpen, setAuditOpen } = useOps()
  const { records, capa } = useAuditStore()
  const [query, setQuery] = React.useState("")
  const [classFilter, setClassFilter] = React.useState<DeviationClass | "ALL">("ALL")
  const [statusFilter, setStatusFilter] = React.useState<CapaStatus | "ALL">("ALL")
  const [capaId, setCapaId] = React.useState<string | null>(null)
  const [dossierId, setDossierId] = React.useState<string | null>(null)

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return records.filter((record) => {
      if (classFilter !== "ALL" && record.classification !== classFilter) return false
      if (statusFilter !== "ALL" && record.capaStatus !== statusFilter) return false
      if (!needle) return true
      return [record.id, record.operator, record.shiftLead, record.channelId, record.zone, record.clause, record.behavior]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
  }, [records, query, classFilter, statusFilter])

  const capaRecord = records.find((r) => r.id === capaId) ?? null
  const dossierRecord = records.find((r) => r.id === dossierId) ?? null

  return (
    <>
      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="flex max-h-[92svh] w-[calc(100%-1.5rem)] max-w-7xl flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-7xl">
          <DialogHeader className="gap-1 border-b border-border px-6 py-4 text-left">
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="size-5 text-signal" aria-hidden="true" />
              审计与 CAPA 追踪 (Audit Trail &amp; CAPA)
            </DialogTitle>
            <DialogDescription>
              GMP 偏差记录、存证卷宗与纠正预防措施的闭环追踪，数据保存在本机浏览器。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-background/40 px-6 py-3">
            <div className="relative min-w-60 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索偏差编码、责任人、机位或 GMP 条款"
                aria-label="搜索偏差记录"
                className="pl-9"
              />
            </div>
            <Select value={classFilter} onValueChange={(value) => setClassFilter(value as DeviationClass | "ALL")}>
              <SelectTrigger className="w-48" aria-label="按严重等级筛选">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部等级</SelectItem>
                {(Object.keys(CLASSIFICATION_LABEL) as DeviationClass[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {CLASSIFICATION_LABEL[key]} ({CLASS_ENGLISH[key]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as CapaStatus | "ALL")}>
              <SelectTrigger className="w-60" aria-label="按 CAPA 状态筛选">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部状态</SelectItem>
                {(Object.keys(CAPA_STATUS_LABEL) as CapaStatus[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {CAPA_STATUS_LABEL[key]} ({CAPA_STATUS_ENGLISH[key]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="font-mono text-xs text-muted-foreground" role="status">
              {filtered.length} / {records.length} 条记录
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <Table className="min-w-[1080px]">
              <TableHeader>
                <TableRow>
                  <TableHead>偏差编码</TableHead>
                  <TableHead>关联机位与区域</TableHead>
                  <TableHead>违规行为与 GMP 条款</TableHead>
                  <TableHead>严重等级</TableHead>
                  <TableHead>发生时间与存证哈希</TableHead>
                  <TableHead>责任人</TableHead>
                  <TableHead>CAPA 状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                      没有符合筛选条件的偏差记录
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-mono text-xs">{record.id}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-signal">{record.channelId}</span> {record.zone}
                      </TableCell>
                      <TableCell className="max-w-64 whitespace-normal">
                        <span className="block">{record.behavior}</span>
                        <span className="block text-xs text-muted-foreground">{record.clause}</span>
                      </TableCell>
                      <TableCell>
                        <ClassificationBadge value={record.classification} />
                      </TableCell>
                      <TableCell>
                        <span className="block font-mono text-xs">{record.occurredAt}</span>
                        <span className="block font-mono text-xs text-muted-foreground" title={record.sha256}>
                          SHA-256 {record.sha256.slice(0, 8)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="block text-sm">{record.operator}</span>
                        <span className="block text-xs text-muted-foreground">{record.shiftLead}</span>
                      </TableCell>
                      <TableCell>
                        <CapaStatusBadge value={record.capaStatus} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={record.capaStatus === "APPROVED" ? "outline" : "default"}
                            className={record.capaStatus === "APPROVED" ? undefined : "bg-signal text-black hover:bg-signal/90"}
                            onClick={() => setCapaId(record.id)}
                          >
                            <ClipboardCheck data-icon="inline-start" />
                            {record.capaStatus === "APPROVED" ? "查看 CAPA 单" : "处理 CAPA 单"}
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setDossierId(record.id)}>
                            <FileSearch data-icon="inline-start" />
                            查看存证卷宗
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {capaRecord && (
        <CapaModal
          key={capaRecord.id}
          record={capaRecord}
          initial={capa[capaRecord.id] ?? createEmptyCapa(capaRecord.id)}
          onClose={() => setCapaId(null)}
        />
      )}
      {dossierRecord && <DossierDialog key={dossierRecord.id} record={dossierRecord} onClose={() => setDossierId(null)} />}
    </>
  )
}
