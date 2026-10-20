"use client"

import { TooltipProvider } from "@/components/ui/tooltip"
import { AlertDrawer } from "./alert-drawer"
import { IncidentFeed } from "./incident-feed"
import { MonitorGrid } from "./monitor-grid"
import { OpsHeader } from "./ops-header"
import { OpsProvider } from "./ops-provider"
import { RuleStudioModal } from "./rule-studio-modal"
import { VideoSearchBar } from "./video-search-bar"

export function OpsCenter() {
  return (
    <OpsProvider>
      <TooltipProvider delayDuration={150}>
        <div className="flex min-h-svh flex-col bg-background lg:h-svh lg:overflow-hidden">
          <OpsHeader />
          <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
            <div className="scrollbar-thin flex min-h-0 flex-col gap-6 lg:overflow-y-auto lg:pr-2">
              <MonitorGrid />
              <VideoSearchBar />
            </div>
            <IncidentFeed className="lg:h-full" />
          </main>
        </div>
        <AlertDrawer />
        <RuleStudioModal />
      </TooltipProvider>
    </OpsProvider>
  )
}
