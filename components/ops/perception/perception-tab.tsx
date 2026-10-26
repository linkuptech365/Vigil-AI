"use client"

import { VisionCard } from "@/components/vigil/config/vision-card"
import { EscalationQueue } from "./escalation-queue"
import { FilterMetrics } from "./filter-metrics"
import { HitLog } from "./hit-log"
import { LearningPanel } from "./learning-panel"
import { RoiManager } from "./roi-manager"
import { TrackingCanvas } from "./tracking-canvas"

export function PerceptionTab() {
  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 p-4 lg:overflow-y-auto">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">一级感知初筛 (Tier-1 Perception & Filtering)</h2>
        <p className="text-sm text-muted-foreground">
          Step 2：边缘轻量 CV 模型完成目标检测、跨帧追踪与电子围栏碰撞判定，只把值得研判的片段送往 Tier-2 VLM。
        </p>
      </div>
      <FilterMetrics />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <TrackingCanvas />
          <HitLog />
          <LearningPanel />
        </div>
        <RoiManager />
      </div>
      <section aria-labelledby="tier1-rules-title" className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 id="tier1-rules-title" className="text-sm font-semibold">
            一级初筛规则录入
          </h3>
          <p className="text-xs text-muted-foreground">
            用中文描述稽查要求并编译为检测词表，或手动添加词条；保存后立即热更新到视觉服务，对所有实时通道生效。
          </p>
        </div>
        <VisionCard />
      </section>
      <EscalationQueue />
    </div>
  )
}
