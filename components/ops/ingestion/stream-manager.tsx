"use client"

import * as React from "react"
import { Plug, PlugZap, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { maskUrl } from "@/lib/ops/ingestion-data"
import { cn } from "@/lib/utils"
import { AddStreamDialog } from "./add-stream-dialog"
import { useIngestion } from "./ingestion-provider"
import { ProtocolBadge, StreamStatusBadge } from "./stream-badges"

export function StreamManager() {
  const { streams, selectedId, selectChannel, removeStream, toggleOffline } = useIngestion()
  const [dialogOpen, setDialogOpen] = React.useState(false)

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">多协议视频流管理</CardTitle>
          <CardDescription>
            RTSP / RTMP / GB28181 / WebRTC / 本地文件，凭据在列表中自动脱敏
          </CardDescription>
        </div>
        <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" />
          添加新视频流 (Add Stream)
        </Button>
      </CardHeader>

      <CardContent className="p-0">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">通道</TableHead>
              <TableHead>协议</TableHead>
              <TableHead>源地址</TableHead>
              <TableHead>分辨率</TableHead>
              <TableHead className="text-right">码率</TableHead>
              <TableHead className="text-right">延迟</TableHead>
              <TableHead>健康状态</TableHead>
              <TableHead className="pr-4 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {streams.map((stream) => {
              const offline = stream.status === "offline"
              return (
                <TableRow
                  key={stream.id}
                  data-state={stream.id === selectedId ? "selected" : undefined}
                  className={cn(stream.id === selectedId && "bg-primary/5")}
                >
                  <TableCell className="pl-4">
                    <button
                      type="button"
                      onClick={() => selectChannel(stream.id)}
                      className="flex flex-col items-start gap-0.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`选中通道 ${stream.id} ${stream.name}`}
                    >
                      <span className="font-mono text-xs font-semibold text-primary">{stream.id}</span>
                      <span className="max-w-44 truncate text-sm">{stream.name}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <ProtocolBadge protocol={stream.protocol} />
                  </TableCell>
                  <TableCell>
                    <span
                      className="block max-w-64 truncate font-mono text-xs text-muted-foreground"
                      title={maskUrl(stream.url)}
                    >
                      {maskUrl(stream.url)}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{stream.resolution}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {offline ? "--" : `${stream.bitrate.toFixed(1)} Mbps`}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      stream.status === "frame_drop" && "text-warning",
                    )}
                  >
                    {offline ? "--" : `${stream.latency}ms`}
                  </TableCell>
                  <TableCell>
                    <StreamStatusBadge status={stream.status} />
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={offline ? `重连 ${stream.id}` : `模拟 ${stream.id} 断流`}
                            onClick={() => toggleOffline(stream.id)}
                          >
                            {offline ? <PlugZap /> : <Plug />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{offline ? "重新连接" : "模拟断流"}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`移除 ${stream.id}`}
                            onClick={() => removeStream(stream.id)}
                          >
                            <Trash2 />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>移除通道</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>

      <AddStreamDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  )
}
