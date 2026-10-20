"use client"

import { Cable, LayoutGrid } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AlertDrawer } from "./alert-drawer"
import { IncidentFeed } from "./incident-feed"
import { IngestionPipeline } from "./ingestion/ingestion-pipeline"
import { IngestionProvider } from "./ingestion/ingestion-provider"
import { MonitorGrid } from "./monitor-grid"
import { OpsHeader } from "./ops-header"
import { OpsProvider } from "./ops-provider"
import { RuleStudioModal } from "./rule-studio-modal"
import { VideoSearchBar } from "./video-search-bar"

export function OpsCenter() {
  return (
    <OpsProvider>
      <IngestionProvider>
        <TooltipProvider delayDuration={150}>
          <div className="flex min-h-svh flex-col bg-background lg:h-svh lg:overflow-hidden">
            <OpsHeader />
            <Tabs defaultValue="monitor" className="min-h-0 flex-1 gap-0">
              <div className="border-b border-border px-4 py-2">
                <TabsList className="h-9">
                  <TabsTrigger value="monitor" className="gap-1.5 px-3">
                    <LayoutGrid aria-hidden="true" />
                    监控矩阵与告警
                  </TabsTrigger>
                  <TabsTrigger value="ingestion" className="gap-1.5 px-3">
                    <Cable aria-hidden="true" />
                    接入管道
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
            </Tabs>
          </div>
          <AlertDrawer />
          <RuleStudioModal />
        </TooltipProvider>
      </IngestionProvider>
    </OpsProvider>
  )
}
