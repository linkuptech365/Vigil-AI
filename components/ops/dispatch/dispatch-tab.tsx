"use client"

import { ClipboardCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useOps } from "../ops-provider"
import { DispatchProvider } from "./dispatch-provider"
import { EvidenceDossierView } from "./evidence-dossier-view"
import { IncidentWorkflow } from "./incident-workflow"
import { MultiChannelBroadcast } from "./multi-channel-broadcast"

interface DispatchTabProps {
  onLocate: (channelId: string) => void
}

export function DispatchTab({ onLocate }: DispatchTabProps) {
  const { setAuditOpen } = useOps()
  return (
    <DispatchProvider>
      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-6 p-4 lg:overflow-y-auto [&>*]:shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">
              处置联动与证据归档 (Dispatch & Archival)
            </h2>
            <p className="text-sm text-muted-foreground">
              Step 5：把告警固化为不可篡改的证据案卷，驱动派工到结案的闭环，并同步广播到物理与数字终端。
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setAuditOpen(true)}>
            <ClipboardCheck data-icon="inline-start" />
            审计与 CAPA 追踪 (Audit Trail &amp; CAPA)
          </Button>
        </div>
        <EvidenceDossierView onLocate={onLocate} />
        <IncidentWorkflow />
        <MultiChannelBroadcast />
      </div>
    </DispatchProvider>
  )
}
