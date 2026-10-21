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
import { localChannelId } from "@/lib/ops/local-source"
import { usePerception } from "./perception-provider"

export function PerceptionSourceSelect() {
  const { cameraId, setCameraId, localVideos, selectedLocalVideo } = usePerception()
  const value = selectedLocalVideo ? localChannelId(selectedLocalVideo.id) : cameraId

  return (
    <Select value={value} onValueChange={setCameraId}>
      <SelectTrigger size="sm" className="w-full" aria-label="切换视频源">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>监控视频流 (CAM-01 ~ CAM-04)</SelectLabel>
          {CAMERAS.map((cam) => (
            <SelectItem key={cam.id} value={cam.id}>
              {cam.code} {cam.name}
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
