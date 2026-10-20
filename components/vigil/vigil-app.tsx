"use client"

import { ListVideo, Settings2, Siren } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertsTab } from "./alerts/alerts-tab"
import { AppHeader } from "./app-header"
import { ConfigTab } from "./config/config-tab"
import { FrameTestDialog } from "./frame-test-dialog"
import { QueueTab } from "./queue/queue-tab"
import { VideoDetailDialog } from "./video-detail-dialog"
import { type TabId, VigilProvider, useVigil } from "./vigil-provider"

function Shell() {
  const { activeTab, setActiveTab, queue } = useVigil()
  const alertCount = queue.filter((v) => v.status === "alert").length

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-7xl flex-col px-4 pb-12 sm:px-6">
      <AppHeader />
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TabId)}
        className="gap-6"
      >
        <TabsList variant="line" className="h-10 w-full justify-start border-b border-border">
          <TabsTrigger value="config" className="flex-none px-4">
            <Settings2 />
            配置
          </TabsTrigger>
          <TabsTrigger value="queue" className="flex-none px-4">
            <ListVideo />
            检测队列
            {queue.length > 0 && (
              <Badge variant="secondary" className="font-mono">
                {queue.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="alerts" className="flex-none px-4">
            <Siren />
            预警中心
            {alertCount > 0 && (
              <Badge className="bg-destructive font-mono text-white">{alertCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="config">
          <ConfigTab />
        </TabsContent>
        <TabsContent value="queue">
          <QueueTab />
        </TabsContent>
        <TabsContent value="alerts">
          <AlertsTab />
        </TabsContent>
      </Tabs>
      <VideoDetailDialog />
      <FrameTestDialog />
    </div>
  )
}

export function VigilApp() {
  return (
    <VigilProvider>
      <Shell />
    </VigilProvider>
  )
}
