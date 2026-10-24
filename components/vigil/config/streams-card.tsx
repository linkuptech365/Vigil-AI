"use client"

import * as React from "react"
import { CirclePlus, Radio, Trash2, Zap } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { RTSP_TEMPLATES, STREAM_ZONES, validateSourceUrl, type StreamView } from "@/lib/vigil/streams"
import { EngineBanner } from "../streams/engine-banner"
import { useStreams } from "../streams/use-streams"

const STATUS_LABEL: Record<StreamView["status"], string> = {
  online: "在线",
  idle: "待命",
  offline: "离线",
}

function StreamRow({
  stream,
  onTest,
  onRemove,
  onPatrol,
}: {
  stream: StreamView
  onTest: (id: string) => Promise<void>
  onRemove: (id: string) => void
  onPatrol: (id: string, value: boolean) => void
}) {
  const [testing, setTesting] = React.useState(false)
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              stream.status === "online" ? "bg-success" : stream.status === "idle" ? "bg-warning" : "bg-destructive"
            )}
            aria-hidden="true"
          />
          <span className="truncate text-sm font-medium">{stream.name}</span>
          <Badge variant="outline" className="shrink-0 text-xs">
            {STATUS_LABEL[stream.status]}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={testing}
            onClick={async () => {
              setTesting(true)
              await onTest(stream.id)
              setTesting(false)
            }}
          >
            {testing ? <Spinner data-icon="inline-start" /> : <Zap data-icon="inline-start" />}
            测试
          </Button>
          {stream.builtin ? null : (
            <Button size="icon-sm" variant="ghost" aria-label={`移除 ${stream.name}`} onClick={() => onRemove(stream.id)}>
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      <p className="truncate font-mono text-xs text-muted-foreground" title={stream.sourceMasked}>
        {stream.zone} · {stream.sourceMasked || "内置模拟循环推流"}
      </p>
      <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        每分钟自动抓帧研判
        <Switch checked={stream.autoPatrol} onCheckedChange={(value) => onPatrol(stream.id, value)} aria-label={`${stream.name} 自动巡检`} />
      </label>
    </li>
  )
}

export function StreamsCard() {
  const { engine, streams, loading, addStream, removeStream, setAutoPatrol, testStream, engineAction } = useStreams()
  const [name, setName] = React.useState("")
  const [zone, setZone] = React.useState<string>(STREAM_ZONES[0])
  const [source, setSource] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError("请填写摄像头名称")
    const invalid = validateSourceUrl(source)
    if (invalid) return setError(invalid)
    setError(null)
    setSubmitting(true)
    const ok = await addStream({ name: name.trim(), zone, source: source.trim() })
    setSubmitting(false)
    if (ok) {
      setName("")
      setSource("")
    }
  }

  const handleTest = async (id: string) => {
    const result = await testStream(id)
    if (result.ok) toast.success(`通道可用 · ${result.latencyMs}ms`, { description: result.message })
    else toast.error("通道测试失败", { description: result.message })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radio className="size-4 text-primary" aria-hidden="true" />
          实时监控通道
        </CardTitle>
        <CardDescription>接入 RTSP 摄像头后，画面进入「实时监控」页，可随时抓帧交给模型研判。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {engine ? <EngineBanner engine={engine} onAction={engineAction} /> : null}

        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="stream-name">摄像头名称</FieldLabel>
                <Input id="stream-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：B 级区 1 号灌装位" maxLength={60} />
              </Field>
              <Field>
                <FieldLabel htmlFor="stream-zone">所属区域</FieldLabel>
                <Select value={zone} onValueChange={setZone}>
                  <SelectTrigger id="stream-zone" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STREAM_ZONES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="stream-source">RTSP 视频流地址</FieldLabel>
              <Input
                id="stream-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="rtsp://用户名:密码@192.168.1.64:554/Streaming/Channels/101"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
              />
              <div className="flex flex-wrap gap-1.5">
                {RTSP_TEMPLATES.map((template) => (
                  <Button key={template.id} type="button" size="xs" variant="outline" onClick={() => setSource(template.url)}>
                    {template.label}
                  </Button>
                ))}
              </div>
              {error ? (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">密码仅保存在服务端，页面上只显示脱敏后的地址。</p>
              )}
            </Field>
            <Button type="submit" disabled={submitting} className="self-start">
              {submitting ? <Spinner data-icon="inline-start" /> : <CirclePlus data-icon="inline-start" />}
              接入摄像头
            </Button>
          </FieldGroup>
        </form>

        {loading && streams.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> 读取通道中…
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {streams.map((stream) => (
              <StreamRow key={stream.id} stream={stream} onTest={handleTest} onRemove={(id) => void removeStream(id)} onPatrol={(id, value) => void setAutoPatrol(id, value)} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
