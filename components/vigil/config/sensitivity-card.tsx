"use client"

import { ScanEye } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  PATROL_INTERVAL_SECONDS,
  TIER1_ORDER,
  TIER1_PRESETS,
  formatThresholdPercent,
  resolveTier1Config,
  type Tier1Sensitivity,
} from "@/lib/vigil/sensitivity"
import { useVigil } from "../vigil-provider"

export function SensitivityCard() {
  const { settings, updateSettings } = useVigil()
  const current = resolveTier1Config(settings.tier1Sensitivity)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanEye className="size-4 text-primary" aria-hidden="true" />
          一级初筛灵敏度
        </CardTitle>
        <CardDescription>
          决定像素差分把多大的画面变化判定为动作，修改后对下一次分析生效。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <RadioGroup
            value={current.mode}
            onValueChange={(value) =>
              updateSettings({ tier1Sensitivity: value as Tier1Sensitivity })
            }
            aria-label="一级初筛灵敏度"
          >
            {TIER1_ORDER.map((mode) => {
              const preset = TIER1_PRESETS[mode]
              const id = `tier1-${mode}`
              return (
                <FieldLabel key={mode} htmlFor={id}>
                  <Field orientation="horizontal">
                    <RadioGroupItem value={mode} id={id} />
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{preset.modeName}</span>
                        <Badge variant="outline" className="font-mono">
                          {formatThresholdPercent(preset.motionThresholdPercent)}%
                        </Badge>
                        <span className="text-xs text-muted-foreground">{preset.scene}</span>
                      </div>
                      <FieldDescription>{preset.description}</FieldDescription>
                    </div>
                  </Field>
                </FieldLabel>
              )
            })}
          </RadioGroup>
          <FieldDescription>
            当前：相邻帧变化像素占比超过 {formatThresholdPercent(current.motionThresholdPercent)}%
            （单像素灰度差 {current.grayDiff}）即判定为动作。静止区间每 {PATROL_INTERVAL_SECONDS}{" "}
            秒强制抽 1 帧送检，保证静止违规不漏检。
          </FieldDescription>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
