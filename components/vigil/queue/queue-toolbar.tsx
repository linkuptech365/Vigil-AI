"use client"

import { LayoutGrid, List, Search } from "lucide-react"

import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { QueueViewMode } from "@/lib/vigil/video-source"

interface QueueToolbarProps {
  query: string
  onQueryChange: (value: string) => void
  mode: QueueViewMode
  onModeChange: (mode: QueueViewMode) => void
  total: number
  shown: number
}

export function QueueToolbar({
  query,
  onQueryChange,
  mode,
  onModeChange,
  total,
  shown,
}: QueueToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <InputGroup className="w-full sm:max-w-sm">
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索文件名或路径"
          aria-label="搜索检测队列"
        />
      </InputGroup>

      <ToggleGroup
        type="single"
        variant="outline"
        value={mode}
        onValueChange={(value) => {
          if (value === "grid" || value === "table") onModeChange(value)
        }}
        aria-label="队列视图切换"
      >
        <ToggleGroupItem value="grid" aria-label="监控矩阵视图" title="监控矩阵视图 (Grid View)">
          <LayoutGrid />
          监控矩阵
        </ToggleGroupItem>
        <ToggleGroupItem value="table" aria-label="详细列表视图" title="详细列表视图 (Table View)">
          <List />
          详细列表
        </ToggleGroupItem>
      </ToggleGroup>

      {query.trim() && (
        <span className="font-mono text-xs text-muted-foreground">
          匹配 {shown} / {total}
        </span>
      )}
    </div>
  )
}
