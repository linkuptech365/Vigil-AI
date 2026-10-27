"use client"

import * as React from "react"
import { Archive, ChevronDown, ChevronUp, MapPin } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { handleImageError, hasMediaSrc, PLACEHOLDER_IMAGE } from "@/lib/ops/media"
import type { RagCase } from "@/lib/ops/rag-types"
import type { LocateOptions } from "@/lib/ops/types"

const SEVERITY_LABEL: Record<RagCase["severity"], string> = {
  CRITICAL: "严重",
  WARNING: "预警",
  INFO: "提示",
}

function Tier2Status({ item }: { item: RagCase }) {
  if (!item.hasVlm) {
    return <Badge variant="outline">未研判</Badge>
  }
  return (
    <Badge variant="outline" className="border-signal/50 text-signal">
      已二级研判{item.vlmTriggered === null ? "" : item.vlmTriggered ? " · 判定预警" : " · 判定安全"}
    </Badge>
  )
}

function CaseRow({
  item,
  expanded,
  onToggle,
  onLocate,
}: {
  item: RagCase
  expanded: boolean
  onToggle: () => void
  onLocate: (channelId: string, opts?: LocateOptions) => void
}) {
  const detailId = `rag-case-detail-${item.id}`
  const title = item.caseId ?? item.alertId

  return (
    <li className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex flex-col gap-3 p-3 sm:flex-row">
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-md bg-black sm:w-48">
          <img
            src={item.thumbnailUrl && hasMediaSrc(item.thumbnailUrl) ? item.thumbnailUrl : PLACEHOLDER_IMAGE}
            alt={`${item.channelName} 案卷证据帧`}
            className="size-full object-cover"
            loading="lazy"
            onError={handleImageError}
          />
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white tabular-nums">
            {item.frameCount} 帧
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs font-medium break-all" title={title}>
              {title}
            </span>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{item.triggeredAt}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {item.channelName}
            {item.zone ? ` · ${item.zone}` : ""} · {item.ruleName}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{SEVERITY_LABEL[item.severity]}</Badge>
            <Tier2Status item={item} />
            {item.archived && (
              <Badge variant="outline" className="gap-1">
                <Archive className="size-3" aria-hidden="true" />
                已归档
              </Badge>
            )}
          </div>
          <dl className="flex flex-col gap-1 text-xs leading-relaxed">
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">一级初筛</dt>
              <dd className="line-clamp-2 min-w-0">{item.tier1Summary || "--"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">二级研判</dt>
              <dd className="line-clamp-2 min-w-0">{item.vlmSummary ?? "尚未执行二级研判"}</dd>
            </div>
          </dl>
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-controls={detailId}
            >
              {expanded ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
              {expanded ? "收起详情" : "展开合成文本与证据帧"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onLocate(item.channelId, { label: item.tier1Summary })}
            >
              <MapPin data-icon="inline-start" />
              定位通道
            </Button>
          </div>
        </div>
      </div>

      {expanded && (
        <div id={detailId} className="flex flex-col gap-3 border-t border-border bg-muted/30 p-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">合成文本（BM25 检索所用四要素与推理依据）</span>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              {item.text || "（该案卷暂无合成文本）"}
            </pre>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">证据帧（{item.frameCount} 帧）</span>
            {item.frameUrls.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {item.frameUrls.map((url, index) => (
                  <img
                    key={url}
                    src={hasMediaSrc(url) ? url : PLACEHOLDER_IMAGE}
                    alt={`${title} 第 ${index + 1} 帧`}
                    className="aspect-video w-full rounded-md border border-border bg-black object-cover"
                    loading="lazy"
                    onError={handleImageError}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">该案卷未留存证据帧。</p>
            )}
          </div>
          <p className="font-mono text-[11px] text-muted-foreground">
            入库时间：{item.indexedAt}
            {item.vlmAnalyzedAt ? ` · 二级研判时间：${item.vlmAnalyzedAt}` : ""}
          </p>
        </div>
      )}
    </li>
  )
}

export function RagCaseList({
  cases,
  onLocate,
}: {
  cases: RagCase[]
  onLocate: (channelId: string, opts?: LocateOptions) => void
}) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null)

  return (
    <ul className="flex flex-col gap-3" aria-label="全量案卷列表">
      {cases.map((item) => (
        <CaseRow
          key={item.id}
          item={item}
          expanded={expandedId === item.id}
          onToggle={() => setExpandedId((current) => (current === item.id ? null : item.id))}
          onLocate={onLocate}
        />
      ))}
    </ul>
  )
}
