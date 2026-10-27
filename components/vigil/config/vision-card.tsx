"use client"

import * as React from "react"
import { CircleAlert, Cpu, Download, RotateCw, Save } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { sanitizeVisionConfig, type VisionConfig, type VisionInfo, type VisionStatus } from "@/lib/vigil/vision"
import { useVision } from "../streams/use-vision"

const STATUS_BADGE: Record<VisionStatus, { label: string; className: string }> = {
  ready: { label: "运行中", className: "border-success/40 bg-success/10 text-success" },
  degraded: { label: "降级（仅帧差）", className: "border-warning/40 bg-warning/10 text-warning" },
  loading: { label: "加载模型中", className: "border-warning/40 bg-warning/10 text-warning" },
  starting: { label: "启动中", className: "border-warning/40 bg-warning/10 text-warning" },
  installing: { label: "安装中", className: "border-primary/40 bg-primary/10 text-primary" },
  offline: { label: "未运行", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  disabled: { label: "已停用", className: "border-border bg-muted text-muted-foreground" },
}

function sameConfig(a: VisionConfig, b: VisionConfig) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function EngineStatus({
  engine,
  onAction,
}: {
  engine: VisionInfo
  onAction: (action: "install" | "restart", options?: { light?: boolean; cpu?: boolean; gpu?: boolean }) => Promise<unknown>
}) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const badge = STATUS_BADGE[engine.status]
  const run = async (key: string, action: "install" | "restart", options?: { light?: boolean; cpu?: boolean; gpu?: boolean }) => {
    setBusy(key)
    await onAction(action, options)
    setBusy(null)
  }
  const needInstall = engine.issue === "not-installed" || engine.issue === "no-python"
  const showFix = engine.status !== "ready" && engine.status !== "installing" && engine.issue !== "disabled"

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn("gap-1.5", badge.className)}>
          {engine.status === "installing" || engine.status === "loading" || engine.status === "starting" ? <Spinner /> : null}
          {badge.label}
        </Badge>
        {engine.status === "ready" || engine.status === "degraded" ? (
          <span className="font-mono text-xs text-muted-foreground">
            {engine.mode} · {engine.device} · 跟踪 {engine.trackerKind || "—"}
          </span>
        ) : null}
        {engine.lastReloadMs > 0 ? (
          <span className="font-mono text-xs text-muted-foreground">上次热更新 {engine.lastReloadMs} ms</span>
        ) : null}
      </div>

      {engine.status !== "ready" ? (
        <Alert className={engine.status === "offline" ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10"}>
          <CircleAlert className={engine.status === "offline" ? "text-destructive" : "text-warning"} />
          <AlertTitle>{engine.status === "degraded" ? "已降级为帧差初筛" : "视觉初筛服务未就绪"}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{engine.message}</span>
            {engine.installOutput ? (
              <pre className="max-h-32 overflow-auto rounded-md bg-background/60 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {engine.installOutput}
              </pre>
            ) : null}
            {showFix ? (
              <div className="flex flex-wrap gap-2">
                {needInstall || engine.status === "degraded" ? (
                  <>
                    <Button size="sm" disabled={busy !== null} onClick={() => void run("full", "install", { cpu: true })}>
                      {busy === "full" ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                      一键自动部署视觉环境
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("gpu", "install", { gpu: true })}>
                      {busy === "gpu" ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                      NVIDIA GPU 版
                    </Button>
                    {needInstall ? (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("light", "install", { light: true })}>
                        {busy === "light" ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                        仅轻量帧差
                      </Button>
                    ) : null}
                  </>
                ) : null}
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("restart", "restart")}>
                  {busy === "restart" ? <Spinner data-icon="inline-start" /> : <RotateCw data-icon="inline-start" />}
                  重启服务
                </Button>
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

/** 视觉引擎全局参数控制台：不含任何检测词表，词表一律由各通道专属配置管理。 */
export function VisionCard() {
  const { config, engine, loading, loadError, save, engineAction } = useVision()
  const [draft, setDraft] = React.useState<VisionConfig | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (config && !draft) setDraft(config)
  }, [config, draft])

  if (loading || !draft || !engine) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="size-4 text-primary" aria-hidden="true" />
            视觉引擎全局参数
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <CircleAlert className="size-4" aria-hidden="true" />
              视觉配置加载失败，请刷新页面重试。
            </p>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </CardContent>
      </Card>
    )
  }

  const dirty = config ? !sameConfig(draft, config) : false
  const patch = (next: Partial<VisionConfig>) => setDraft((prev) => (prev ? { ...prev, ...next } : prev))

  const handleSave = async () => {
    setSaving(true)
    const response = await save(sanitizeVisionConfig(draft, draft))
    setSaving(false)
    if (response) setDraft(response.config)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="size-4 text-primary" aria-hidden="true" />
          视觉引擎全局参数
        </CardTitle>
        <CardDescription>
          所有通道共用的 Vision Engine 运行参数。检测词表、提示词与记忆锚点不在此处配置，由上方各通道的专属初筛词表独立管理。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <EngineStatus engine={engine} onAction={engineAction} />

        <Field orientation="horizontal">
          <Switch id="vision-enabled" checked={draft.enabled} onCheckedChange={(enabled) => patch({ enabled })} />
          <FieldLabel htmlFor="vision-enabled">启用视觉漏斗（关闭后回落到定时整段研判）</FieldLabel>
        </Field>

        <Separator />

        <FieldGroup>
          <Field>
            <FieldLabel>
              像素差异阈值 <span className="font-mono text-muted-foreground">{draft.motionThresholdPct.toFixed(1)}%</span>
            </FieldLabel>
            <Slider min={0} max={20} step={0.1} value={[draft.motionThresholdPct]} onValueChange={([v]) => patch({ motionThresholdPct: v })} aria-label="像素差异阈值" />
            <FieldDescription>低于该比例的画面变化视为静止，直接被 Tier-0 拦截。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>
              置信度区间{" "}
              <span className="font-mono text-muted-foreground">
                {draft.confidenceLow.toFixed(2)} – {draft.confidenceHigh.toFixed(2)}
              </span>
            </FieldLabel>
            <Slider
              min={0.05}
              max={0.99}
              step={0.01}
              value={[draft.confidenceLow, draft.confidenceHigh]}
              onValueChange={([low, high]) => patch({ confidenceLow: low, confidenceHigh: high })}
              aria-label="置信度区间"
            />
            <FieldDescription>低于下限视为未检出；高于上限视为确认存在；介于两者之间视为存疑。</FieldDescription>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="vision-fps">采样帧率（帧/秒）</FieldLabel>
              <Input id="vision-fps" type="number" min={0.2} max={10} step={0.5} value={draft.sampleFps} onChange={(e) => patch({ sampleFps: Number(e.target.value) })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="vision-frames">连续命中帧数</FieldLabel>
              <Input id="vision-frames" type="number" min={1} max={30} step={1} value={draft.minConsecutiveFrames} onChange={(e) => patch({ minConsecutiveFrames: Number(e.target.value) })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="vision-cooldown">同一主体冷却（秒）</FieldLabel>
              <Input id="vision-cooldown" type="number" min={0} max={3600} step={5} value={draft.cooldownSeconds} onChange={(e) => patch({ cooldownSeconds: Number(e.target.value) })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="vision-static">静止复检间隔（秒）</FieldLabel>
              <Input id="vision-static" type="number" min={0} max={300} step={5} value={draft.staticRecheckSeconds} onChange={(e) => patch({ staticRecheckSeconds: Number(e.target.value) })} />
            </Field>
          </div>
        </FieldGroup>

        <Separator />

        <FieldGroup>
          <Field orientation="horizontal">
            <Switch id="vision-audit" checked={draft.auditMode} onCheckedChange={(auditMode) => patch({ auditMode })} />
            <FieldLabel htmlFor="vision-audit">链路审计模式（逐帧记录一级门禁决策，含被拦截的帧）</FieldLabel>
          </Field>
          <FieldDescription>
            开启后可在「运维中心 · 审计」中回溯每帧的原始检出、各规则逐级门禁结果与二级研判输入输出，用于排查“为什么没报警”。会增加少量写入开销，排查完毕建议关闭。
          </FieldDescription>
          {draft.auditMode ? (
            <Field className="sm:max-w-xs">
              <FieldLabel htmlFor="vision-audit-retention">审计保留条数</FieldLabel>
              <Input
                id="vision-audit-retention"
                type="number"
                min={50}
                max={5000}
                step={50}
                value={draft.auditRetention}
                onChange={(e) => patch({ auditRetention: Number(e.target.value) })}
              />
            </Field>
          ) : null}
        </FieldGroup>

        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-xs", dirty ? "text-warning" : "text-muted-foreground")}>{dirty ? "有未保存的修改" : "已与服务端同步"}</span>
          <div className="flex gap-2">
            {dirty && config ? (
              <Button variant="outline" onClick={() => setDraft(config)} disabled={saving}>
                还原
              </Button>
            ) : null}
            <Button onClick={() => void handleSave()} disabled={!dirty || saving}>
              {saving ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              保存并热更新
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
