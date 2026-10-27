"use client"

import * as React from "react"
import useSWR from "swr"
import { CircleAlert, CircleCheck, RotateCcw, Sparkles, Trash2, Video } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useStreams } from "@/components/vigil/streams/use-streams"
import { errorMessage, getJson, sendJson } from "@/lib/ops/rules-client"
import {
  CHANNEL_CONFIG_ENDPOINT,
  channelConfigUrl,
  type ChannelCompileSummary,
  type ChannelConfigResponse,
  type CompiledTag,
} from "@/lib/vigil/channel-perception"
import { visionRoleLabel } from "@/lib/vigil/vision"
import { cn } from "@/lib/utils"
import { usePerception } from "./perception-provider"

type CompileState = { tag: CompiledTag; state: "new" | "existing" }

function ChannelEditor({ channelId, channelName }: { channelId: string; channelName: string }) {
  const { data, error, isLoading, mutate } = useSWR<ChannelConfigResponse>(channelConfigUrl(channelId), getJson, {
    keepPreviousData: false,
    revalidateOnFocus: false,
  })
  const [prompt, setPrompt] = React.useState("")
  const [replace, setReplace] = React.useState(true)
  const [compiling, setCompiling] = React.useState(false)
  const [savingTags, setSavingTags] = React.useState(false)
  const [note, setNote] = React.useState<ChannelCompileSummary | null>(null)
  const [compiled, setCompiled] = React.useState<CompileState[] | null>(null)
  const synced = React.useRef(false)

  React.useEffect(() => {
    if (data && !synced.current) {
      synced.current = true
      setPrompt(data.config.raw_prompt)
    }
  }, [data])

  const apply = React.useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await sendJson<ChannelConfigResponse>(CHANNEL_CONFIG_ENDPOINT, "POST", { channelId, ...payload })
      await mutate(response, { revalidate: false })
      return response
    },
    [channelId, mutate]
  )

  const handleCompile = async () => {
    if (compiling || prompt.trim().length < 2) return
    setCompiling(true)
    setNote(null)
    setCompiled(null)
    const previous = new Set((data?.config.compiled_tags ?? []).map((tag) => tag.promptEn.trim().toLowerCase()))
    const loadingId = toast.loading(`正在为「${channelName}」编译检测词表并热更新…`)
    try {
      const response = await apply({ raw_prompt: prompt.trim(), compile: true, mode: replace ? "replace" : "append" })
      const summary = response.compile
      if (summary) {
        setNote(summary)
        setCompiled(
          summary.tags.map((tag) => ({
            tag,
            state: summary.mode === "replace" || !previous.has(tag.promptEn.trim().toLowerCase()) ? "new" : "existing",
          }))
        )
      }
      toast.success(`「${channelName}」已编译 ${summary?.tags.length ?? response.effective_tags.length} 个检测词`, {
        description: response.reload
          ? response.reload.ok
            ? `已热更新到视觉服务（${response.reload.reloadMs} ms），仅对本通道生效`
            : `配置已保存，但热更新未成功：${response.reload.message}`
          : "视觉服务启动后自动生效",
      })
    } catch (caught) {
      toast.error("编译失败", { description: errorMessage(caught) })
    } finally {
      toast.dismiss(loadingId)
      setCompiling(false)
    }
  }

  const saveTags = async (tags: CompiledTag[], successText: string) => {
    setSavingTags(true)
    try {
      const response = await apply({ raw_prompt: prompt.trim(), compiled_tags: tags })
      toast.success(successText, { description: response.reload?.ok ? `已热更新（${response.reload.reloadMs} ms）` : undefined })
    } catch (caught) {
      toast.error("保存失败", { description: errorMessage(caught) })
    } finally {
      setSavingTags(false)
    }
  }

  const handleReset = async () => {
    setSavingTags(true)
    try {
      const response = await apply({ reset: true })
      setPrompt("")
      setNote(null)
      setCompiled(null)
      toast.success(`「${channelName}」已保存的专属词条已清空，仅保留启用规则引用的类别`, { description: response.reload?.ok ? "视觉服务已热更新" : undefined })
    } catch (caught) {
      toast.error("重置失败", { description: errorMessage(caught) })
    } finally {
      setSavingTags(false)
    }
  }

  if (isLoading && !data) return <Skeleton className="h-40 w-full" />
  if (error || !data) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive">
        <CircleAlert className="size-4" aria-hidden="true" />
        通道初筛配置加载失败：{error ? errorMessage(error) : "无数据"}
      </p>
    )
  }

  const tags = data.effective_tags
  const persisted = data.config.compiled_tags
  const persistedKeys = new Set(persisted.map((tag) => tag.promptEn.trim().toLowerCase()))
  const isPersisted = (tag: CompiledTag) => persistedKeys.has(tag.promptEn.trim().toLowerCase())
  const toggleTag = (tag: CompiledTag, enabled: boolean) =>
    saveTags(
      isPersisted(tag)
        ? persisted.map((item) => (item.promptEn === tag.promptEn ? { ...item, enabled } : item))
        : [...persisted, { ...tag, enabled }],
      enabled ? `已启用「${tag.labelZh}」` : `已停用「${tag.labelZh}」`
    )
  const busy = compiling || savingTags

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="channel-instruction">「{channelName}」的中文稽查要求</FieldLabel>
        <Textarea
          id="channel-instruction"
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
            event.preventDefault()
            void handleCompile()
          }}
          disabled={compiling}
          placeholder="例如 1 楼：快递或外卖小哥；2 楼：猫吃猫粮"
        />
        <FieldDescription>
          按回车（Shift+回车换行）或点击编译：中文会被降解为 YOLO-World 可识别的英文实体名词，仅写入当前通道的专属词表并立即热更新，其他通道不受影响。
        </FieldDescription>
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void handleCompile()} disabled={busy || prompt.trim().length < 2}>
          {compiling ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
          {compiling ? "编译中…" : replace ? "编译并热更新（替换本通道词表）" : "编译并热更新（追加到本通道词表）"}
        </Button>
        <Field orientation="horizontal" className="w-auto">
          <Switch id="channel-replace" checked={replace} onCheckedChange={setReplace} disabled={busy} />
          <FieldLabel htmlFor="channel-replace" className="text-xs font-normal text-muted-foreground">
            替换本���道现有词表
          </FieldLabel>
        </Field>
        {data.configured ? (
          <Button variant="outline" size="sm" onClick={() => void handleReset()} disabled={busy}>
            <RotateCcw data-icon="inline-start" />
            清空本通道词表
          </Button>
        ) : null}
      </div>

      {note ? (
        <p className={cn("flex items-center gap-1.5 text-xs", note.source === "llm" ? "text-success" : "text-warning")}>
          {note.source === "llm" ? <CircleCheck className="size-3.5" aria-hidden="true" /> : <CircleAlert className="size-3.5" aria-hidden="true" />}
          {note.note}
        </p>
      ) : null}

      {compiled && compiled.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/40 p-3" aria-live="polite">
          <div className="flex items-center gap-2 text-xs font-medium">
            <CircleCheck className="size-3.5 text-success" aria-hidden="true" />
            本次编译出 {compiled.length} 个检测 Tag，已热更新到「{channelName}」
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {compiled.map(({ tag, state }) => (
              <li key={tag.promptEn} className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs">
                <span className="font-mono">{tag.promptEn}</span>
                <span className="text-muted-foreground">{tag.labelZh}</span>
                <Badge variant="outline" className="text-[10px]">
                  {visionRoleLabel(tag.role)}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn("text-[10px]", state === "new" ? "border-success/40 bg-success/10 text-success" : "text-muted-foreground")}
                >
                  {state === "new" ? "新增" : "已存在"}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-medium">
            当前生效词表 <span className="font-mono text-xs text-muted-foreground">{tags.length} 条</span>
          </h4>
          <Badge
            variant="outline"
            className={cn("text-[10px]", data.source !== "baseline" ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground")}
          >
            {data.source === "rules"
              ? `${persisted.length} 条已保存词条 + ${data.binding.rules.length} 条启用规则的类别`
              : data.source === "custom"
                ? `${persisted.length} 条已保存词条 · 无启用规则`
                : "无启用规则 · 仅人员锚点基线"}
          </Badge>
        </div>
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">词表为空，请先输入中文描述并编译。</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {tags.map((tag) => (
              <li
                key={tag.promptEn}
                className={cn("flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs", !tag.enabled && "opacity-60")}
              >
                <Switch
                  checked={tag.enabled}
                  disabled={busy}
                  aria-label={`启用 ${tag.labelZh}`}
                  onCheckedChange={(enabled) => void toggleTag(tag, enabled)}
                />
                <span className="font-mono">{tag.promptEn}</span>
                <span className="text-muted-foreground">{tag.labelZh}</span>
                {!isPersisted(tag) ? (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    规则引用
                  </Badge>
                ) : null}
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {visionRoleLabel(tag.role)}
                </Badge>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy || !isPersisted(tag)}
                  aria-label={isPersisted(tag) ? `删除 ${tag.labelZh}` : `${tag.labelZh} 由启用规则引用，需在规则中移除`}
                  onClick={() =>
                    void saveTags(
                      persisted.filter((item) => item.promptEn !== tag.promptEn),
                      `已删除「${tag.labelZh}」`
                    )
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          编辑词条会为本通道生成专属词表副本；下方「二级��哺」补充的词条与记忆锚点同样只属于本通道。
        </p>
      </div>
    </div>
  )
}

export function ChannelPerceptionCard() {
  const { cameraId, setCameraId } = usePerception()
  const { streams } = useStreams()
  const current = streams.find((stream) => stream.id === cameraId)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="size-4 text-primary" aria-hidden="true" />
          通道专属初筛词表
        </CardTitle>
        <CardDescription>
          系统不维护全局词表：每路通道独立管理提示词、编译标签、记忆锚点与二级反哺状态，推理时只加载本通道词表，互不串扰。切换通道会同步切换上方画面与二级反哺面板。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="channel-select">当前通道</FieldLabel>
          <Select value={current ? current.id : undefined} onValueChange={setCameraId}>
            <SelectTrigger id="channel-select" size="sm" className="w-full max-w-sm" aria-label="选择要配置的通道">
              <SelectValue placeholder={streams.length === 0 ? "暂无实时通道" : "请选择实时通道"} />
            </SelectTrigger>
            <SelectContent>
              {streams.map((stream) => (
                <SelectItem key={stream.id} value={stream.id}>
                  {stream.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {current ? (
          <ChannelEditor key={current.id} channelId={current.id} channelName={current.name} />
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CircleAlert className="size-4" aria-hidden="true" />
            当前视频源不是实时通道（本地视频或演示源），没有可配置的专属词表；请先选择一个实时通道。
          </p>
        )}
      </CardContent>
    </Card>
  )
}
