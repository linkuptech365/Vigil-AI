"use client"

import type { LocateOptions } from "@/lib/ops/types"
import { DemoEmptyState, DemoOnly } from "../demo-empty-state"
import { CausalReasoningView } from "./causal-reasoning-view"
import { VideoRagStudio } from "./video-rag-studio"
import { VlmInferenceRunner } from "./vlm-inference-runner"
import { VlmProvider } from "./vlm-provider"

interface VlmTabProps {
  onLocate: (channelId: string, opts?: LocateOptions) => void
}

export function VlmTab({ onLocate }: VlmTabProps) {
  return (
    <VlmProvider>
      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 p-4 lg:overflow-y-auto [&>*]:shrink-0">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">二级多模态研判 (Tier-2 VLM Cognition)</h2>
          <p className="text-sm text-muted-foreground">
            Step 3：只有通过一级初筛的片段才会进入多模态大模型，输出行为意图、因果链与结构化结论，并沉淀为可语义检索的 Video-RAG 索引。
          </p>
        </div>
        <VlmInferenceRunner />
        <CausalReasoningView />
        <DemoOnly
          fallback={
            <DemoEmptyState
              title="Video-RAG 语料库尚未建立"
              description="当前没有可检索的真实视频切片索引。示例语料仅在开启演示数据时显示。"
            />
          }
        >
          <VideoRagStudio onLocate={onLocate} />
        </DemoOnly>
      </div>
    </VlmProvider>
  )
}
