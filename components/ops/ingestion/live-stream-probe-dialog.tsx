"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { maskUrl } from "@/lib/ops/ingestion-data"
import type { StreamSource } from "@/lib/ops/ingestion-types"
import { LiveStreamTester } from "./live-stream-tester"

interface LiveStreamProbeDialogProps {
  stream: StreamSource | null
  onOpenChange: (open: boolean) => void
}

export function LiveStreamProbeDialog({ stream, onOpenChange }: LiveStreamProbeDialogProps) {
  return (
    <Dialog open={stream !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {stream ? `${stream.id} · ${stream.name}` : "拉流测通"} 实时拉流测通
          </DialogTitle>
          <DialogDescription>
            {stream ? (
              <>
                设备源地址 <span className="font-mono">{maskUrl(stream.url)}</span>
                ，浏览器无法直连该协议，默认通过网关转码的 HLS 地址测通。
              </>
            ) : (
              "选择协议与流地址后开始拉流测通。"
            )}
          </DialogDescription>
        </DialogHeader>
        {stream && <LiveStreamTester key={stream.id} initialChannelId={stream.id} autoConnect />}
      </DialogContent>
    </Dialog>
  )
}
