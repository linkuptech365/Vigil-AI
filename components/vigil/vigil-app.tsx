"use client"

import { ListVideo, Settings2, Siren, Video } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertsTab } from "./alerts/alerts-tab"
import { AppHeader } from "./app-header"
import { ConfigTab } from "./config/config-tab"
import { FrameTestDialog } from "./frame-test-dialog"
import { QueueTab } from "./queue/queue-tab"
import { LiveWall } from "./streams/live-wall"
import { useStreams } from "./streams/use-streams"
import { VideoDetailDialog } from "./video-detail-dialog"
import { type TabId, useVigil } from "./vigil-provider"

function Shell() {
  const { activeTab, setActiveTab, queue } = useVigil()
  const { onlineCount, alerts: streamAlerts } = useStreams()
  const alertCount = queue.filter((v) => v.status === "alert").length + streamAlerts.length

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
          <TabsTrigger value="live" className="flex-none px-4">
            <Video />
            实时监控
            {onlineCount > 0 && (
              <Badge variant="secondary" className="font-mono">
                {onlineCount}
              </Badge>
            )}
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
        <TabsContent value="config" forceMount className="data-[state=inactive]:hidden">
          <ConfigTab />
        </TabsContent>
        <TabsContent value="live" forceMount className="data-[state=inactive]:hidden">
          <LiveWall />
        </TabsContent>
        <TabsContent value="queue" forceMount className="data-[state=inactive]:hidden">
          <QueueTab />
        </TabsContent>
        <TabsContent value="alerts" forceMount className="data-[state=inactive]:hidden">
          <AlertsTab />
        </TabsContent>
      </Tabs>
      <VideoDetailDialog />
      <FrameTestDialog />
    </div>
  )
}

export function VigilApp() {
  return <Shell />
}
