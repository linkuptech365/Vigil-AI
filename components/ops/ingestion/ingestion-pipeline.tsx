"use client"

import { CircularBufferView } from "./circular-buffer-view"
import { DynamicFpsController } from "./dynamic-fps-controller"
import { IngestionScorecards } from "./ingestion-scorecards"
import { StreamManager } from "./stream-manager"

export function IngestionPipeline() {
  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 p-4 lg:overflow-y-auto">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">视频流接入与动态预处理管道 (Ingestion Pipeline)</h2>
        <p className="text-sm text-muted-foreground">
          Step 1：多协议接入 / 动态自适应抽帧 / 环形缓存切片，输出证据包至 Tier-2 VLM 推理。
        </p>
      </div>
      <IngestionScorecards />
      <StreamManager />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DynamicFpsController />
        <CircularBufferView />
      </div>
    </div>
  )
}
