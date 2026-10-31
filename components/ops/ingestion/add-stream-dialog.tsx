"use client"

import * as React from "react"
import { CheckCircle2, ScanSearch } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { URL_PLACEHOLDER, composeUrl } from "@/lib/ops/ingestion-data"
import {
  PROTOCOL_LABEL,
  type NewStreamInput,
  type StreamProtocol,
} from "@/lib/ops/ingestion-types"
import { useIngestion } from "./ingestion-provider"

const PROTOCOLS = Object.keys(PROTOCOL_LABEL) as StreamProtocol[]
const NEEDS_CREDENTIALS: StreamProtocol[] = ["RTSP", "RTMP", "GB28181"]
const DETECT_RESOLUTIONS = ["1080P", "2K", "720P", "4K"]

interface DetectedSpecs {
  resolution: string
  fps: number
  bitrate: number
  codec: string
}

function detectSpecs(url: string): DetectedSpecs {
  const seed = url.length
  return {
    resolution: DETECT_RESOLUTIONS[seed % DETECT_RESOLUTIONS.length],
    fps: seed % 2 === 0 ? 25 : 30,
    bitrate: Math.round((2.4 + (seed % 6) * 0.6) * 10) / 10,
    codec: seed % 3 === 0 ? "H.265" : "H.264",
  }
}

function AddStreamForm({ onDone }: { onDone: () => void }) {
  const { addStream } = useIngestion()
  const [protocol, setProtocol] = React.useState<StreamProtocol>("RTSP")
  const [name, setName] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [detecting, setDetecting] = React.useState(false)
  const [specs, setSpecs] = React.useState<DetectedSpecs | null>(null)
  const timerRef = React.useRef<number | null>(null)

  React.useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const canSubmit = name.trim().length > 0 && url.trim().length > 0
  const showCredentials = NEEDS_CREDENTIALS.includes(protocol)

  const runDetect = () => {
    setDetecting(true)
    setSpecs(null)
    timerRef.current = window.setTimeout(() => {
      setSpecs(detectSpecs(url))
      setDetecting(false)
    }, 1200)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    const input: NewStreamInput = {
      name: name.trim(),
      protocol,
      url: showCredentials ? composeUrl(url, username.trim(), password) : url.trim(),
      resolution: specs?.resolution ?? "1080P",
      bitrate: specs?.bitrate ?? 4,
    }
    addStream(input)
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>添加新视频流 (Add Stream)</DialogTitle>
        <DialogDescription>
          选择接入协议并填写源地址，系统将自动探测分辨率、码率与编码。
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <Field>
          <FieldLabel>接入协议</FieldLabel>
          <ToggleGroup
            type="single"
            value={protocol}
            onValueChange={(value) => {
              if (value) {
                setProtocol(value as StreamProtocol)
                setSpecs(null)
              }
            }}
            aria-label="接入协议"
            className="flex flex-wrap justify-start gap-1.5"
          >
            {PROTOCOLS.map((p) => (
              <ToggleGroupItem
                key={p}
                value={p}
                className="h-8 border border-border px-3 font-mono text-xs data-[state=on]:border-primary/60 data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
              >
                {PROTOCOL_LABEL[p]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <Field>
          <FieldLabel htmlFor="stream-name">通道名称</FieldLabel>
          <Input
            id="stream-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：成品库东侧出入口"
            autoComplete="off"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="stream-url">
            {protocol === "FILE" ? "文件或目录路径" : "流地址 (Stream URL)"}
          </FieldLabel>
          <Input
            id="stream-url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setSpecs(null)
            }}
            placeholder={URL_PLACEHOLDER[protocol]}
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
          />
          {protocol === "FILE" && (
            <FieldDescription>支持单个视频文件或整个文件夹，按文件名顺序循环回放。</FieldDescription>
          )}
        </Field>

        {showCredentials && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="stream-user">用户名</FieldLabel>
              <Input
                id="stream-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="stream-pass">密码</FieldLabel>
              <Input
                id="stream-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </Field>
          </div>
        )}
      </FieldGroup>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">流规格自动探测</span>
            <span className="text-xs text-muted-foreground">拉取首个 GOP 解析分辨率 / 码率 / 编码</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!url.trim() || detecting}
            onClick={runDetect}
          >
            {detecting ? <Spinner data-icon="inline-start" /> : <ScanSearch data-icon="inline-start" />}
            {detecting ? "探测中" : "自动探测"}
          </Button>
        </div>
        {specs && (
          <dl
            className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs sm:grid-cols-4"
            aria-live="polite"
          >
            {[
              ["分辨率", specs.resolution],
              ["帧率", `${specs.fps} FPS`],
              ["码率", `${specs.bitrate} Mbps`],
              ["编码", specs.codec],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="flex items-center gap-1 text-success">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          接入通道
        </Button>
      </DialogFooter>
    </form>
  )
}

export function AddStreamDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <AddStreamForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
