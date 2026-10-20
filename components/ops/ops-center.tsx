"use client"

import * as React from "react"
import { toast } from "sonner"
import { Cable, LayoutGrid, ScanEye, Sparkles } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AlertDrawer } from "./alert-drawer"
import { IncidentFeed } from "./incident-feed"
import { IngestionPipeline } from "./ingestion/ingestion-pipeline"
import { IngestionProvider } from "./ingestion/ingestion-provider"
import { MonitorGrid } from "./monitor-grid"
import { OpsHeader } from "./ops-header"
import { OpsProvider, useOps } from "./ops-provider"
import { PerceptionProvider } from "./perception/perception-provider"
import { PerceptionTab } from "./perception/perception-tab"
import { RuleStudioModal } from "./rule-studio-modal"
import { VideoSearchBar } from "./video-search-bar"
import { VlmTab } from "./vlm/vlm-tab"

function OpsShell() {
  const { focusCamera } = useOps()
  const [tab, setTab] = React.useState("monitor")

  const locateInMonitor = React.useCallback(
    (channelId: string) => {
      focusCamera(channelId, { single: true })
      setTab("monitor")
      toast.success(`已在监控矩阵中定位 ${channelId}`)
    },
    [focusCamera]
  )

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-svh flex-col bg-background lg:h-svh lg:overflow-hidden">
        <OpsHeader />
        <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
          <div className="scrollbar-thin overflow-x-auto border-b border-border px-4 py-2">
            <TabsList className="h-9">
              <TabsTrigger value="monitor" className="gap-1.5 px-3">
                <LayoutGrid aria-hidden="true" />
                实时监控矩阵
              </TabsTrigger>
              <TabsTrigger value="ingestion" className="gap-1.5 px-3">
                <Cable aria-hidden="true" />
                接入与预处理
              </TabsTrigger>
              <TabsTrigger value="perception" className="gap-1.5 px-3">
                <ScanEye aria-hidden="true" />
                一级感知初筛
              </TabsTrigger>
              <TabsTrigger value="vlm" className="gap-1.5 px-3">
                <Sparkles aria-hidden="true" />
                二级多模态研判
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            value="monitor"
            className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]"
          >
            <div className="scrollbar-thin flex min-h-0 flex-col gap-6 lg:overflow-y-auto lg:pr-2">
              <MonitorGrid />
              <VideoSearchBar />
            </div>
            <IncidentFeed className="lg:h-full" />
          </TabsContent>
          <TabsContent value="ingestion" className="flex min-h-0 flex-1 flex-col">
            <IngestionPipeline />
          </TabsContent>
          <TabsContent value="perception" className="flex min-h-0 flex-1 flex-col">
            <PerceptionTab />
          </TabsContent>
          <TabsContent value="vlm" className="flex min-h-0 flex-1 flex-col">
            <VlmTab onLocate={locateInMonitor} />
          </TabsContent>
        </Tabs>
      </div>
      <AlertDrawer />
      <RuleStudioModal />
    </TooltipProvider>
  )
}

export function OpsCenter() {
  return (
    <OpsProvider>
      <IngestionProvider>
        <PerceptionProvider>
          <OpsShell />
        </PerceptionProvider>
      </IngestionProvider>
    </OpsProvider>
  )
}
