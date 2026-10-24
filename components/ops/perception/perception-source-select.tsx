"use client"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CAMERAS } from "@/lib/ops/data"
import { useDemoMode } from "@/components/vigil/demo-mode-provider"
import { useStreams } from "@/components/vigil/streams/use-streams"
import { localChannelId } from "@/lib/ops/local-source"
import { usePerception } from "./perception-provider"

export function PerceptionSourceSelect() {
  const { cameraId, setCameraId, localVideos, selectedLocalVideo } = usePerception()
  const { enabled: demo } = useDemoMode()
  const { streams } = useStreams()
  const value = selectedLocalVideo ? localChannelId(selectedLocalVideo.id) : cameraId

  return (
    <Select value={value || undefined} onValueChange={setCameraId}>
      <SelectTrigger size="sm" className="w-full" aria-label="切换视频源">
        <SelectValue placeholder="请选择视频源" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{demo ? "监控视频流 (CAM-01 ~ CAM-04)" : "真实摄像头通道"}</SelectLabel>
          {demo &&
            CAMERAS.map((cam) => (
              <SelectItem key={cam.id} value={cam.id}>
                {cam.code} {cam.name}
              </SelectItem>
            ))}
          {!demo && streams.length === 0 && (
            <SelectItem value="stream:__empty" disabled>
              暂无通道，请先在配置页接入摄像头
            </SelectItem>
          )}
          {!demo &&
            streams.map((stream) => (
              <SelectItem key={stream.id} value={stream.id}>
                {stream.name}
              </SelectItem>
            ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>本地导入视频 (Local Video Queue)</SelectLabel>
          {localVideos.length === 0 ? (
            <SelectItem value="local:__empty" disabled>
              暂无本地视频，请先在检测队列导入
            </SelectItem>
          ) : (
            localVideos.map((video) => (
              <SelectItem key={video.id} value={localChannelId(video.id)}>
                [本地] {video.name}
              </SelectItem>
            ))
          )}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
