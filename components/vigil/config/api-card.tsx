"use client"

import { CircleAlert, CircleCheck, Link2, Network } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { API_PRESETS } from "@/lib/vigil/data"
import { useVigil } from "../vigil-provider"
import { ApiKeyField } from "./api-key-field"

export function ApiCard() {
  const { settings, updateSettings, applyPreset, ping, runPing } = useVigil()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Network className="size-4 text-primary" aria-hidden="true" />
          多模态大模型 API 接入
        </CardTitle>
        <CardDescription>
          配置视觉语言模型推理端点、鉴权密钥与帧采样策略。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>快速预设</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={2}
              value={settings.presetId}
              onValueChange={(value) => value && applyPreset(value)}
              className="flex-wrap justify-start"
              aria-label="API 预设"
            >
              {API_PRESETS.map((preset) => (
                <ToggleGroupItem key={preset.id} value={preset.id}>
                  {preset.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field>
            <FieldLabel htmlFor="api-url">API 端点 (Endpoint)</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <InputGroup className="flex-1">
                <InputGroupAddon>
                  <Link2 aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="api-url"
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  placeholder="http://localhost:8000/api/v1/analyze"
                  value={settings.apiUrl}
                  onChange={(event) =>
                    updateSettings({ apiUrl: event.target.value, presetId: "custom" })
                  }
                  className="font-mono"
                />
              </InputGroup>
              <Button
                variant="secondary"
                onClick={runPing}
                disabled={ping.state === "testing"}
              >
                {ping.state === "testing" && <Spinner data-icon="inline-start" />}
                {ping.state === "testing" ? "正在测通真实端点..." : "测试 API 连通性"}
              </Button>
            </div>
            <div aria-live="polite" className="min-h-5 text-sm">
              {ping.state === "testing" && (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <Spinner />
                  <span className="font-mono">正在测通真实端点...</span>
                </p>
              )}
              {ping.state === "ok" && (
                <p className="flex items-start gap-1.5 text-success">
                  <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="font-mono">
                    ● 握手成功 (RTT: {ping.latency}ms | {ping.model})
                  </span>
                </p>
              )}
              {ping.state === "error" && (
                <p className="flex items-start gap-1.5 text-destructive">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="font-mono">✕ 连通失败 ({ping.message})</span>
                </p>
              )}
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="api-key">API Key</FieldLabel>
            <ApiKeyField />
            <FieldDescription>
              输入完成后失焦或点击「脱敏锁定」，密钥将被隐藏，仅保存在当前会话内存中。
            </FieldDescription>
          </Field>

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
