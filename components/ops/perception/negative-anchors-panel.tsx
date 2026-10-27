"use client"

import * as React from "react"
import useSWR from "swr"
import { ChevronDown, ShieldOff, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage, getJson, sendJson } from "@/lib/ops/rules-client"
import type { NegativeAnchor } from "@/lib/vigil/streams"
import { cn } from "@/lib/utils"

interface AnchorsResponse {
  anchors: NegativeAnchor[]
  limit: number
}

const DEFAULT_LIMIT = 50

const anchorsUrl = (channelId: string) => `/api/v1/channels/${encodeURIComponent(channelId)}/negative-anchors`

function formatTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** bbox 为归一化 [ymin, xmin, ymax, xmax]，换算为大致画面方位。 */
function regionLabel([ymin, xmin, ymax, xmax]: NegativeAnchor["bbox"]) {
  const cx = (xmin + xmax) / 2
  const cy = (ymin + ymax) / 2
  const horizontal = cx < 1 / 3 ? "左侧" : cx > 2 / 3 ? "右侧" : "中间"
  const vertical = cy < 1 / 3 ? "上方" : cy > 2 / 3 ? "下方" : "中部"
  return `${horizontal}${vertical}区域`
}

const formatBbox = (bbox: NegativeAnchor["bbox"]) => `[${bbox.map((value) => value.toFixed(2)).join(", ")}]`

export function NegativeAnchorsPanel({ channelId, channelName }: { channelId: string; channelName: string }) {
  const { data, error, isLoading, mutate } = useSWR<AnchorsResponse>(anchorsUrl(channelId), getJson, {
    revalidateOnFocus: false,
    keepPreviousData: false,
  })
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState<NegativeAnchor | null>(null)
  const [removingId, setRemovingId] = React.useState<string | null>(null)

  const anchors = data?.anchors ?? []
  const limit = data?.limit ?? DEFAULT_LIMIT
  const bodyId = `negative-anchors-body-${channelId}`

  async function confirmRemove() {
    const target = pending
    if (!target) return
    setPending(null)
    setRemovingId(target.id)
    try {
      const response = await sendJson<{ anchors: NegativeAnchor[] }>(anchorsUrl(channelId), "DELETE", { anchorId: target.id })
      await mutate({ anchors: response.anchors, limit }, { revalidate: false })
      toast.success("已解除该位置的负样本抑制")
    } catch (err) {
      toast.error(`解除抑制失败：${errorMessage(err)}`)
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <ShieldOff className="size-4 text-primary" aria-hidden="true" />
        <span className="text-sm font-medium">静态干扰排除项 (Negative Anchors)</span>
        <Badge variant="outline" className="ml-1 font-mono text-[10px]">
          {isLoading ? "加载中" : error ? "读取失败" : `已登记 ${anchors.length} / ${limit} 个锚点`}
        </Badge>
        <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open ? (
        <div id={bodyId} className="flex flex-col gap-2 border-t border-border px-3 py-3">
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : error ? (
            <div className="flex items-center justify-between gap-2 text-xs text-destructive">
              <span>负样本列表读取失败：{errorMessage(error)}</span>
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void mutate()}>
                重试
              </Button>
            </div>
          ) : anchors.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              暂无静态排除锚点。可在「历史命中明细」中将误报检测框一键标为固定误判。
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {anchors.map((anchor) => (
                <li key={anchor.id} className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {anchor.label === "*" ? (
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          通配 *
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {anchor.label}
                        </Badge>
                      )}
                      <span className="text-xs">{regionLabel(anchor.bbox)}</span>
                      <span className="font-mono text-[10px] text-muted-foreground" title="[ymin, xmin, ymax, xmax] 归一化坐标">
                        {formatBbox(anchor.bbox)}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">登记于 {formatTime(anchor.createdAt)}</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={removingId === anchor.id}
                    onClick={() => setPending(anchor)}
                    aria-label={`删除负样本锚点 ${anchor.label}（${regionLabel(anchor.bbox)}）`}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    {removingId === anchor.id ? "解除中…" : "删除 / 解除抑制"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            命中锚点位置且类别一致（或通配）的检测框会在一级初筛被静默过滤；删除后「{channelName}」将立即热更新到 Worker，该区域恢复正常检测。
          </p>
        </div>
      ) : null}

      <AlertDialog open={pending !== null} onOpenChange={(next) => (next ? undefined : setPending(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>解除该位置的负样本抑制？</AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? `「${pending.label === "*" ? "通配 *" : pending.label}」· ${regionLabel(pending.bbox)} 将恢复正常检测，之前被静默过滤的同位置目标可能再次触发初筛。`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRemove()}>确认解除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
