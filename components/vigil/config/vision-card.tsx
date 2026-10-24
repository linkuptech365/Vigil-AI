"use client"

import * as React from "react"
import { CircleAlert, CircleCheck, Download, Filter, Plus, RotateCw, Save, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  MAX_VOCABULARY,
  VISION_ROLES,
  sanitizeVisionConfig,
  type VisionConfig,
  type VisionInfo,
  type VisionRole,
  type VisionStatus,
  type VocabularyItem,
} from "@/lib/vigil/vision"
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

function VocabularyRow({
  item,
  onChange,
  onRemove,
}: {
  item: VocabularyItem
  onChange: (patch: Partial<VocabularyItem>) => void
  onRemove: () => void
}) {
  return (
    <li className={cn("flex flex-col gap-2 rounded-lg border border-border p-2.5", !item.enabled && "opacity-60")}>
      <div className="flex items-center gap-2">
        <Switch checked={item.enabled} onCheckedChange={(enabled) => onChange({ enabled })} aria-label={`启用 ${item.labelZh}`} />
        <Input
          value={item.labelZh}
          onChange={(event) => onChange({ labelZh: event.target.value })}
          aria-label="中文名称"
          placeholder="中文名称"
          className="h-8 flex-1"
        />
        <Select value={item.role} onValueChange={(role) => onChange({ role: role as VisionRole })}>
          <SelectTrigger className="h-8 w-28" aria-label="词条角色">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VISION_ROLES.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="icon-sm" variant="ghost" aria-label={`删除 ${item.labelZh}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      <Input
        value={item.promptEn}
        onChange={(event) => onChange({ promptEn: event.target.value })}
        aria-label="英文检测词"
        placeholder="英文检测词，例如 face mask on face"
        spellCheck={false}
        className="h-8 font-mono text-xs"
      />
    </li>
  )
}

export function VisionCard() {
  const { config, engine, loading, loadError, save, compile, engineAction } = useVision()
  const [draft, setDraft] = React.useState<VisionConfig | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [compiling, setCompiling] = React.useState(false)
  const [compileNote, setCompileNote] = React.useState<{ source: "llm" | "fallback"; text: string } | null>(null)

  React.useEffect(() => {
    if (config && !draft) setDraft(config)
  }, [config, draft])

  if (loading || !draft || !engine) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="size-4 text-primary" aria-hidden="true" />
            视觉漏斗初筛
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
  const patchItem = (id: string, next: Partial<VocabularyItem>) =>
    setDraft((prev) => (prev ? { ...prev, vocabulary: prev.vocabulary.map((item) => (item.id === id ? { ...item, ...next } : item)) } : prev))
  const removeItem = (id: string) =>
    setDraft((prev) => (prev ? { ...prev, vocabulary: prev.vocabulary.filter((item) => item.id !== id) } : prev))
  const addItem = () =>
    setDraft((prev) =>
      prev && prev.vocabulary.length < MAX_VOCABULARY
        ? {
            ...prev,
            vocabulary: [
              ...prev.vocabulary,
              { id: `v${Date.now().toString(36)}`, labelZh: "新词条", promptEn: "", role: "hazard_target", enabled: true },
            ],
          }
        : prev
    )

  const handleSave = async () => {
    const cleaned = sanitizeVisionConfig(draft, draft)
    const invalid = draft.vocabulary.filter((item) => !cleaned.vocabulary.some((c) => c.promptEn === item.promptEn.trim()))
    if (invalid.length > 0) {
      toast.error("存在无效的英文检测词", { description: "英文词只允许字母、数字、空格与 , ' - /，长度 2–64 个字符，且不能重复。" })
      return
    }
    setSaving(true)
    const response = await save(cleaned)
    setSaving(false)
    if (response) setDraft(response.config)
  }

  const handleCompile = async () => {
    setCompiling(true)
    setCompileNote(null)
    const response = await compile(draft.naturalLanguageInstruction, true)
    setCompiling(false)
    if (!response) return
    setDraft(response.config)
    setCompileNote({ source: response.source, text: response.note })
    toast.success(`已生成 ${response.vocabulary.length} 个检测词`, {
      description: response.reload ? `已热更新到视觉服务（${response.reload.reloadMs} ms）` : "视觉服务启动后自动生效",
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="size-4 text-primary" aria-hidden="true" />
          视觉漏斗初筛
        </CardTitle>
        <CardDescription>
          帧差过滤静止画面，YOLO-World 按下方词表检测并跟踪人员，仅在判定疑似违规时才调用大模型复核，大幅降低 Token 消耗。
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
            <FieldLabel htmlFor="vision-instruction">用中文描述稽查要求</FieldLabel>
            <Textarea
              id="vision-instruction"
              rows={3}
              value={draft.naturalLanguageInstruction}
              onChange={(event) => patch({ naturalLanguageInstruction: event.target.value })}
              placeholder="例如：洁净区人员必须戴口罩和手套，不允许露出头发，地面不能遗留工具"
            />
            <FieldDescription>点击编译后，系统自动翻译为英文检测词表并立即热更新，无需重启。</FieldDescription>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void handleCompile()} disabled={compiling || draft.naturalLanguageInstruction.trim().length < 2}>
              {compiling ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
              {compiling ? "编译中…" : "编译并热更新"}
            </Button>
            {compileNote ? (
              <p className={cn("flex items-center gap-1.5 text-xs", compileNote.source === "llm" ? "text-success" : "text-warning")}>
                {compileNote.source === "llm" ? <CircleCheck className="size-3.5" aria-hidden="true" /> : <CircleAlert className="size-3.5" aria-hidden="true" />}
                {compileNote.text}
              </p>
            ) : null}
          </div>
        </FieldGroup>

        <Separator />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              检测词表 <span className="font-mono text-xs text-muted-foreground">{draft.vocabulary.length}/{MAX_VOCABULARY}</span>
            </h3>
            <Button size="sm" variant="outline" onClick={addItem} disabled={draft.vocabulary.length >= MAX_VOCABULARY}>
              <Plus data-icon="inline-start" />
              添加词条
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {draft.vocabulary.map((item) => (
              <VocabularyRow key={item.id} item={item} onChange={(next) => patchItem(item.id, next)} onRemove={() => removeItem(item.id)} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            主体锚点用于分配 Track ID（至少启用一个）；必需劳保在人员身上检测不到时判为疑似；违规目标一出现即判为疑似。
          </p>
        </div>

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
              <FieldLabel htmlFor="vision-cooldown">同一人员冷却（秒）</FieldLabel>
              <Input id="vision-cooldown" type="number" min={0} max={3600} step={5} value={draft.cooldownSeconds} onChange={(e) => patch({ cooldownSeconds: Number(e.target.value) })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="vision-static">静止复检间隔（秒）</FieldLabel>
              <Input id="vision-static" type="number" min={0} max={300} step={5} value={draft.staticRecheckSeconds} onChange={(e) => patch({ staticRecheckSeconds: Number(e.target.value) })} />
            </Field>
          </div>
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
