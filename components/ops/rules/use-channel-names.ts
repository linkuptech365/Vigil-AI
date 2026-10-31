"use client"

import * as React from "react"
import useSWR from "swr"

import { STREAMS_ENDPOINT } from "@/components/vigil/streams/use-streams"
import { getJson } from "@/lib/ops/rules-client"
import type { ChannelNames } from "@/lib/ops/rule-binding"
import type { StreamsResponse } from "@/lib/vigil/streams"

/** 规则界面所有通道名称的唯一来源：/api/v1/streams 返回的真实通道及其用户设置的名称。 */
export function useChannelNames() {
  const { data } = useSWR<StreamsResponse>(STREAMS_ENDPOINT, getJson, { keepPreviousData: true })
  const streams = data?.streams

  return React.useMemo(() => {
    const list = streams ?? []
    const names: ChannelNames = new Map(list.map((stream) => [stream.id, stream.name]))
    return { streams: list, names }
  }, [streams])
}
