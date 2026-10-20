"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { useIngestion } from "./ingestion-provider"

export function ChannelSelector({ className }: { className?: string }) {
  const { streams, selectedId, selectChannel } = useIngestion()

  return (
    <ToggleGroup
      type="single"
      value={selectedId}
      onValueChange={(value) => value && selectChannel(value)}
      aria-label="选择视频通道"
      className={cn("flex flex-wrap justify-start gap-1.5", className)}
    >
      {streams.map((stream) => (
        <ToggleGroupItem
          key={stream.id}
          value={stream.id}
          className="h-8 gap-2 border border-border px-2.5 font-mono text-xs data-[state=on]:border-primary/60 data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
        >
          <span>{stream.id}</span>
          <span className="tabular-nums text-muted-foreground">
            {stream.status === "offline" ? "OFF" : `${stream.currentFps} FPS`}
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
