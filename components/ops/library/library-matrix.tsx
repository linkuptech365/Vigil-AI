"use client"

import Link from "next/link"
import { FolderSearch, Grid2x2, Grid3x3, ScanEye } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useVigil } from "@/components/vigil/vigil-provider"
import { cn } from "@/lib/utils"
import { type LibraryGrid, useOps } from "../ops-provider"
import { LibraryCard } from "./library-card"

export function LibraryMatrix() {
  const { queue } = useVigil()
  const { libraryGrid, setLibraryGrid, showOverlays, toggleOverlays } = useOps()

  const analyzed = queue.filter((video) => video.status === "safe" || video.status === "alert").length
  const alerts = queue.filter((video) => video.status === "alert").length

  return (
    <section aria-labelledby="library-matrix-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="library-matrix-title" className="text-sm font-semibold">
            检索视频源矩阵
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            {queue.length} 路 · 已检 {analyzed} · 预警 {alerts}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle
            variant="outline"
            size="sm"
            pressed={showOverlays}
            onPressedChange={toggleOverlays}
            aria-label="显示 AI 识别标注层"
          >
            <ScanEye />
            AI 标注层
          </Toggle>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(libraryGrid)}
            onValueChange={(value) => value && setLibraryGrid(Number(value) as LibraryGrid)}
            aria-label="矩阵列数"
          >
            <ToggleGroupItem value="2" aria-label="2 列矩阵">
              <Grid2x2 />
              2×2
            </ToggleGroupItem>
            <ToggleGroupItem value="3" aria-label="3 列矩阵">
              <Grid3x3 />
              3×3
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {queue.length === 0 ? (
        <Empty className="rounded-lg border border-dashed border-border py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderSearch />
            </EmptyMedia>
            <EmptyTitle>还没有检索到视频</EmptyTitle>
            <EmptyDescription>
              在控制台扫描目录或生成 GMP 算例后，视频会自动出现在这里。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild size="sm">
              <Link href="/console">前往控制台</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 gap-3 sm:grid-cols-2",
            libraryGrid === 3 && "xl:grid-cols-3"
          )}
        >
          {queue.map((video) => (
            <LibraryCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </section>
  )
}
