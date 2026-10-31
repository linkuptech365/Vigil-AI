"use client"

import { SlidersHorizontal } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useVigil } from "../vigil-provider"

export function SamplingCard() {
  const { settings, updateSettings } = useVigil()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />
          分析参数
        </CardTitle>
        <CardDescription>
          配置视频帧采样策略与预警置信度阈值。模型接入请在上方「模型网关与默认模型」中管理。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>视频抽帧频率 (FPS)</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={String(settings.samplingFps)}
              onValueChange={(value) =>
                value && updateSettings({ samplingFps: Number(value) as 1 | 2 | 5 })
              }
              className="justify-start"
              aria-label="抽帧频率"
            >
              {[1, 2, 5].map((fps) => (
                <ToggleGroupItem key={fps} value={String(fps)} className="px-4 font-mono">
                  {fps} FPS
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              频率越高，捕捉短时动作越精准，但推理耗时与 Token 消耗同步增加。
            </FieldDescription>
          </Field>

          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="threshold">预警置信度阈值</FieldLabel>
              <span className="font-mono text-sm text-primary">
                {Math.round(settings.threshold * 100)}%
              </span>
            </div>
            <Slider
              id="threshold"
              min={50}
              max={99}
              step={1}
              value={[Math.round(settings.threshold * 100)]}
              onValueChange={([v]) => updateSettings({ threshold: v / 100 })}
              aria-label="预警置信度阈值"
            />
            <FieldDescription>
              模型置信度低于该阈值的疑似结果将被抑制，不会触发预警。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
