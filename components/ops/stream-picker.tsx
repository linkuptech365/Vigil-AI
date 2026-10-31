"use client"

import { ListVideo } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { StreamView } from "@/lib/vigil/streams"

interface StreamPickerProps {
  streams: StreamView[]
  /** null 表示全部显示 */
  selectedIds: string[] | null
  onChange: (ids: string[] | null) => void
}

const STATUS_TEXT: Record<StreamView["status"], string> = { online: "在线", idle: "待命", offline: "离线" }

export function StreamPicker({ streams, selectedIds, onChange }: StreamPickerProps) {
  const selected = new Set(selectedIds ?? streams.map((s) => s.id))
  const count = streams.filter((s) => selected.has(s.id)).length

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    const ids = streams.filter((s) => next.has(s.id)).map((s) => s.id)
    onChange(ids.length === streams.length ? null : ids)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="选择显示的视频流">
          <ListVideo data-icon="inline-start" />
          选择视频流 ({count}/{streams.length})
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>大屏显示哪些通道</DropdownMenuLabel>
        <DropdownMenuItem onSelect={(event) => { event.preventDefault(); onChange(null) }}>全部显示</DropdownMenuItem>
        <DropdownMenuItem onSelect={(event) => { event.preventDefault(); onChange([]) }}>全部隐藏</DropdownMenuItem>
        <DropdownMenuSeparator />
        {streams.map((stream) => (
          <DropdownMenuCheckboxItem
            key={stream.id}
            checked={selected.has(stream.id)}
            onCheckedChange={(checked) => toggle(stream.id, checked === true)}
            onSelect={(event) => event.preventDefault()}
          >
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span className="truncate">{stream.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{STATUS_TEXT[stream.status]}</span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
