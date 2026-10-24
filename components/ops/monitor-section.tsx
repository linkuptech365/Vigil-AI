"use client"

import { FolderSearch, Radio } from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useStreams } from "@/components/vigil/streams/use-streams"
import { useVigil } from "@/components/vigil/vigil-provider"
import { LibraryMatrix } from "./library/library-matrix"
import { MonitorGrid } from "./monitor-grid"
import { type MonitorMode, useOps } from "./ops-provider"

export function MonitorSection() {
  const { mode, setMode } = useOps()
  const { queue } = useVigil()
  const { streams } = useStreams()

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        type="single"
        variant="outline"
        value={mode}
        onValueChange={(value) => value && setMode(value as MonitorMode)}
        aria-label="监控模式"
        className="w-full justify-start"
      >
        <ToggleGroupItem value="live" className="gap-2 px-3 data-[state=on]:text-destructive">
          <Radio aria-hidden="true" />
          实时机位监控 ({streams.length} 路)
        </ToggleGroupItem>
        <ToggleGroupItem value="library" className="gap-2 px-3 data-[state=on]:text-signal">
          <FolderSearch aria-hidden="true" />
          检索视频源矩阵 ({queue.length} 路)
        </ToggleGroupItem>
      </ToggleGroup>

      {mode === "live" ? <MonitorGrid /> : <LibraryMatrix />}
    </div>
  )
}
