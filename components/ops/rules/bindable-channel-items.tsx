"use client"

import { ToggleGroupItem } from "@/components/ui/toggle-group"
import { STALE_CHANNEL_LABEL, SCOPE_BINDINGS } from "@/lib/ops/rule-binding"
import { useChannelNames } from "./use-channel-names"

/**
 * 规则「绑定通道」候选项：只来自 /api/v1/streams 的真实通道，界面只显示用户设置的名称，
 * 底层值是真实 streamId。已绑定但通道已不存在的旧值显示为「已失效通道」，保留可取消勾选的入口。
 */
export function BindableChannelItems({ selected = [], disabled }: { selected?: readonly string[]; disabled?: boolean }) {
  const { streams, names } = useChannelNames()
  const stale = selected.filter((id) => !SCOPE_BINDINGS.includes(id) && !names.has(id))

  return (
    <>
      {streams.map((stream) => (
        <ToggleGroupItem key={stream.id} value={stream.id} disabled={disabled} className="text-xs">
          {stream.name}
        </ToggleGroupItem>
      ))}
      {stale.map((id) => (
        <ToggleGroupItem
          key={id}
          value={id}
          className="border-dashed text-xs text-muted-foreground"
          title="该通道已被移除，取消勾选即可清理"
        >
          {STALE_CHANNEL_LABEL}
        </ToggleGroupItem>
      ))}
    </>
  )
}
