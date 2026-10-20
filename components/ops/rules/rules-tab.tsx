"use client"

import { CooldownVisualizer } from "./cooldown-visualizer"
import { DedupMetrics } from "./dedup-metrics"
import { IncidentClustering } from "./incident-clustering"
import { RuleStudioView } from "./rule-studio-view"
import { RulesProvider } from "./rules-provider"

interface RulesTabProps {
  onLocate: (channelId: string) => void
}

export function RulesTab({ onLocate }: RulesTabProps) {
  return (
    <RulesProvider>
      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 p-4 lg:overflow-y-auto [&>*]:shrink-0">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">规则与防抖引擎 (Rules & Deduplication)</h2>
          <p className="text-sm text-muted-foreground">
            Step 4：用混合规则决定「看什么」，用冷却窗口与跨机位聚类决定「何时通知」，把告警风暴压缩成少量可处置的工单。
          </p>
        </div>
        <DedupMetrics />
        <RuleStudioView />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <CooldownVisualizer />
          <IncidentClustering onLocate={onLocate} />
        </div>
      </div>
    </RulesProvider>
  )
}
