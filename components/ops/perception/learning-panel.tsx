"use client"

import * as React from "react"
import useSWR from "swr"
import { Anchor, RotateCcw, Sparkles, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { errorMessage, getJson, sendJson } from "@/lib/ops/rules-client"
import { MAX_LEARNED_TAGS, type Tier1LearningResponse } from "@/lib/vigil/tier1-learning"
import { VISION_ENDPOINTS } from "@/lib/vigil/vision"
import { usePerception } from "./perception-provider"

export function LearningPanel() {
  const { cameraId } = usePerception()
  const [busy, setBusy] = React.useState<"reset" | "rollback" | null>(null)
  const { data, mutate } = useSWR<Tier1LearningResponse>(VISION_ENDPOINTS.learning, getJson, {
    refreshInterval: 5000,
    keepPreviousData: true,
  })
  const learning = data?.learning[cameraId]

  async function act(action: "reset" | "rollback") {
    setBusy(action)
    const loadingId = toast.loading(action === "reset" ? "正在恢复初始词表…" : "正在回滚上一版本…")
    try {
      const next = await sendJson<Tier1LearningResponse>(VISION_ENDPOINTS.learning, "POST", { streamId: cameraId, action })
      await mutate(next, { revalidate: false })
      toast.success(action === "reset" ? "已恢复初始词表并清除记忆锚点" : "已回滚到上一版本", {
        description: next.reload ? `视觉服务热更新 ${next.reload.ok ? "成功" : "失败"}：${next.reload.message}` : undefined,
      })
    } catch (error) {
      toast.error("操作失败", { description: errorMessage(error) })
    } finally {
      toast.dismiss(loadingId)
      setBusy(null)
    }
  }

  const empty = !learning || (learning.tags.length === 0 && !learning.anchor)

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-1 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            二级反哺 · 一级自优化
            {learning && learning.version > 0 ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                v{learning.version}
              </Badge>
            ) : null}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || !learning || learning.history.length === 0}
              onClick={() => act("rollback")}
            >
              <Undo2 aria-hidden="true" />
              回滚
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null || empty} onClick={() => act("reset")}>
              <RotateCcw aria-hidden="true" />
              重置
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs">
          二级 VLM 判定成立后，会把更具体的检测词与记忆锚点沉淀到当前通道，下一轮初筛更灵敏。
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 py-3 text-xs">
        {empty ? (
          <p className="py-2 text-center text-muted-foreground">当前通道尚无沉淀内容。二级研判成立后会自动出现。</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground">
                补充检测词 {learning.tags.length}/{MAX_LEARNED_TAGS}
              </span>
              {learning.tags.length === 0 ? (
                <span className="text-muted-foreground">无</span>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {learning.tags.map((tag) => (
                    <li
                      key={tag.promptEn}
                      title={`${tag.promptEn} · ${tag.role === "subject_target" ? "行为主体" : "伴生物体"}`}
                      className="flex items-center gap-1 rounded-md border border-border bg-secondary px-1.5 py-0.5"
                    >
                      <span>{tag.labelZh}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{tag.promptEn}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">≥{Math.round(tag.confidence * 100)}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground">记忆锚点与触发策略</span>
              {learning.anchor ? (
                <p className="flex flex-wrap items-center gap-1.5">
                  <Anchor className="size-3.5 text-primary" aria-hidden="true" />
                  <span>{learning.anchor.description}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    ({learning.anchor.center[0]}, {learning.anchor.center[1]}) r={learning.anchor.radius}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {learning.policy === "ANCHOR_PROXIMITY" ? "主体靠近锚点即触发" : "仍需双目标重叠"}
                  </Badge>
                </p>
              ) : (
                <span className="text-muted-foreground">无锚点，沿用双目标重叠触发</span>
              )}
            </div>
            <p className="text-muted-foreground">{learning.note}</p>
          </>
        )}
      </div>
    </Card>
  )
}
