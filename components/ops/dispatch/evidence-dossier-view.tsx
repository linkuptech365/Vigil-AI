"use client"

import { Archive, Clock, LocateFixed, Video } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { DispatchStatusBadge } from "./dispatch-status-badge"
import { useDispatch } from "./dispatch-provider"
import { KeyframeFilmstrip } from "./keyframe-filmstrip"
import { HashCard, SummaryCard } from "./summary-hash-cards"
import { VideoClipCard } from "./video-clip-card"

interface EvidenceDossierViewProps {
  onLocate?: (channelId: string) => void
}

export function EvidenceDossierView({ onLocate }: EvidenceDossierViewProps) {
  const { dossier, packagingProgress, packageEvidence } = useDispatch()
  const packaging = packagingProgress !== null

  return (
    <section aria-labelledby="dossier-title" className="flex flex-col gap-4">
      <Card className="gap-0 py-4">
        <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <h3 id="dossier-title" className="text-base font-semibold leading-snug text-balance">
              {dossier.title}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="destructive">{dossier.severity}</Badge>
              <DispatchStatusBadge status={dossier.status} />
              <Badge variant="outline" className="gap-1">
                <Video aria-hidden="true" />
                {dossier.channelId} {dossier.channelName}
              </Badge>
              <Badge variant="outline" className="gap-1 font-mono">
                <Clock aria-hidden="true" />
                {dossier.timestamp}
              </Badge>
              <Badge variant="outline" className="font-mono">
                {dossier.incidentId}
              </Badge>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 lg:w-72">
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {onLocate ? (
                <Button type="button" variant="outline" onClick={() => onLocate(dossier.channelId)}>
                  <LocateFixed data-icon="inline-start" />
                  定位机位
                </Button>
              ) : null}
              <Button type="button" onClick={packageEvidence} disabled={packaging}>
                {packaging ? <Spinner data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
                {packaging ? "正在打包存证包" : "一键打包下载完整存证包 (.ZIP)"}
              </Button>
            </div>
            {packaging ? (
              <div className="flex flex-col gap-1">
                <Progress value={packagingProgress} aria-label="存证包打包进度" />
                <span className="text-right font-mono text-[10px] text-muted-foreground">
                  视频切片 + 报告 + 元数据 · {packagingProgress}%
                </span>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <VideoClipCard />
        <KeyframeFilmstrip />
        <SummaryCard />
        <HashCard />
      </div>
    </section>
  )
}
