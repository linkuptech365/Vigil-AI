"use client"

import useSWR from "swr"

import { ToggleGroupItem } from "@/components/ui/toggle-group"
import { STREAMS_ENDPOINT } from "@/components/vigil/streams/use-streams"
import { getJson } from "@/lib/ops/rules-client"
import { ALL_CHANNELS } from "@/lib/ops/rules-data"
import type { StreamsResponse } from "@/lib/vigil/streams"

/**
 * 规则「绑定通道」候选项：内置机位 ID 之外，并入真实接入的通道 ID。
 * 规则按通道真实 ID 精确匹配，只列硬编码的 CAM-xx 会让规则永远绑不上真实通道。
 */
export function BindableChannelItems() {
  const { data } = useSWR<StreamsResponse>(STREAMS_ENDPOINT, getJson, { keepPreviousData: true })
  const names = new Map((data?.streams ?? []).map((stream) => [stream.id, stream.name]))
  const ids = [...ALL_CHANNELS, ...[...names.keys()].filter((id) => !ALL_CHANNELS.includes(id))]

  return (
    <>
      {ids.map((channel) => (
        <ToggleGroupItem key={channel} value={channel} className="font-mono text-xs" title={names.get(channel) ?? channel}>
          {channel}
          {names.get(channel) ? (
            <span className="ml-1 font-sans text-muted-foreground">{names.get(channel)}</span>
          ) : null}
        </ToggleGroupItem>
      ))}
    </>
  )
}
