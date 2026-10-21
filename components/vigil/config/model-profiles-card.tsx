"use client"

import * as React from "react"
import {
  CircleAlert,
  CircleCheck,
  Cpu,
  KeyRound,
  Pencil,
  Plus,
  Star,
  Trash2,
  Zap,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  MODEL_PROVIDERS,
  profileReadiness,
  type ModelProfileInput,
  type ModelProvider,
  type PublicModelProfile,
} from "@/lib/vigil/model-registry"
import { cn } from "@/lib/utils"
import { useVigil } from "../vigil-provider"
import { useModelProfiles, type ProfileTestResult } from "./use-model-profiles"

const PROVIDER_LABEL = Object.fromEntries(MODEL_PROVIDERS.map((p) => [p.id, p.label])) as Record<
  ModelProvider,
  string
>

interface DraftState {
  name: string
  provider: ModelProvider
  baseUrl: string
  modelName: string
  apiKey: string
  clearKey: boolean
  enabled: boolean
}

const EMPTY_DRAFT: DraftState = {
  name: "",
  provider: "openai",
  baseUrl: "",
  modelName: "",
  apiKey: "",
  clearKey: false,
  enabled: true,
}

function draftFrom(profile: PublicModelProfile): DraftState {
  return {
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    modelName: profile.modelName,
    apiKey: "",
    clearKey: false,
    enabled: profile.enabled,
  }
}

export function ModelProfilesCard() {
  const { testProfile } = useVigil()
  const { profiles, loading, loadError, saveProfile, addProfile, removeProfile, makeDefault } =
    useModelProfiles()

  const [editing, setEditing] = React.useState<PublicModelProfile | "new" | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<PublicModelProfile | null>(null)
  const [testingId, setTestingId] = React.useState<string | null>(null)
  const [results, setResults] = React.useState<Record<string, ProfileTestResult>>({})

  const runTest = React.useCallback(
    async (id: string) => {
      setTestingId(id)
      const result = await testProfile(id)
      setResults((prev) => ({ ...prev, [id]: result }))
      setTestingId(null)
    },
    [testProfile]
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="size-4 text-primary" aria-hidden="true" />
          模型网关与默认模型
        </CardTitle>
        <CardDescription>
          每个模型独立保存 Base URL、API Key 与模型名称。全局分析与二级研判都从这里选择模型，密钥只保存在服务端，不会回传浏览器。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading && (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        )}
        {loadError && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <CircleAlert className="size-4" aria-hidden="true" />
            模型列表加载失败，请刷新页面重试。
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {profiles.map((profile) => {
            const readiness = profileReadiness(profile)
            const result = results[profile.id]
            const testing = testingId === profile.id
            return (
              <li
                key={profile.id}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border p-3",
                  profile.isDefault ? "border-primary/50 bg-primary/5" : "border-border",
                  !profile.enabled && "opacity-70"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{profile.name}</span>
                      {profile.isDefault && (
                        <Badge>
                          <Star data-icon="inline-start" />
                          全局默认
                        </Badge>
                      )}
                      <Badge variant="outline">{PROVIDER_LABEL[profile.provider]}</Badge>
                      {!profile.enabled && <Badge variant="secondary">已禁用</Badge>}
                    </div>
                    <p className="truncate font-mono text-xs text-muted-foreground" title={profile.baseUrl}>
                      {profile.baseUrl || "未填写 Base URL"}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      model: {profile.modelName || "未填写"}
                      {" · "}
                      <KeyRound className="inline size-3 align-[-1px]" aria-hidden="true" />{" "}
                      {profile.hasKey ? profile.keyHint : "未配置 Key"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => runTest(profile.id)}
                      disabled={testing || !readiness.ready}
                    >
                      {testing ? <Spinner data-icon="inline-start" /> : <Zap data-icon="inline-start" />}
                      测试连通
                    </Button>
                    {!profile.isDefault && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => makeDefault(profile.id)}
                        disabled={!profile.enabled}
                      >
                        设为默认
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setEditing(profile)}>
                      <Pencil data-icon="inline-start" />
                      编辑
                    </Button>
                    {!profile.builtin && (
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`删除 ${profile.name}`}
                        onClick={() => setPendingDelete(profile)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </div>

                <div aria-live="polite" className="min-h-5 text-sm">
                  {testing && (
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <Spinner />
                      <span className="font-mono">正在由服务端测通真实端点...</span>
                    </p>
                  )}
                  {!testing && result?.ok && (
                    <p className="flex items-start gap-1.5 text-success">
                      <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span className="font-mono">
                        握手成功 (RTT: {result.latency}ms | {result.model})
                      </span>
                    </p>
                  )}
                  {!testing && result && !result.ok && (
                    <p className="flex items-start gap-1.5 text-destructive">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span className="font-mono">连通失败 ({result.message})</span>
                    </p>
                  )}
                  {!testing && !result && !readiness.ready && (
                    <p className="flex items-center gap-1.5 text-warning">
                      <CircleAlert className="size-4" aria-hidden="true" />
                      <span>尚不可用：{readiness.reason}</span>
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <Button variant="outline" className="self-start" onClick={() => setEditing("new")}>
          <Plus data-icon="inline-start" />
          添加自定义模型
        </Button>
      </CardContent>

      <ProfileEditorDialog
        target={editing}
        onClose={() => setEditing(null)}
        onSubmit={async (input, testAfterSave) => {
          const id =
            editing === "new"
              ? await addProfile(input)
              : editing
                ? (await saveProfile(editing.id, input))
                  ? editing.id
                  : null
                : null
          if (!id) return false
          setEditing(null)
          if (testAfterSave) void runTest(id)
          return true
        }}
      />

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除模型「{pendingDelete?.name}」？</DialogTitle>
            <DialogDescription>
              该模型的 URL 与 API Key 将从服务端移除。如它是全局默认模型，系统会自动改用其他已启用的模型。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (pendingDelete && (await removeProfile(pendingDelete.id))) {
                  setResults((prev) => {
                    const next = { ...prev }
                    delete next[pendingDelete.id]
                    return next
                  })
                  setPendingDelete(null)
                }
              }}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function ProfileEditorDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: PublicModelProfile | "new" | null
  onClose: () => void
  onSubmit: (input: ModelProfileInput, testAfterSave: boolean) => Promise<boolean>
}) {
  const [draft, setDraft] = React.useState<DraftState>(EMPTY_DRAFT)
  const [submitting, setSubmitting] = React.useState(false)
  const isNew = target === "new"
  const existing = target && target !== "new" ? target : null

  React.useEffect(() => {
    if (target === "new") setDraft(EMPTY_DRAFT)
    else if (target) setDraft(draftFrom(target))
  }, [target])

  const patch = (next: Partial<DraftState>) => setDraft((prev) => ({ ...prev, ...next }))
  const valid = draft.name.trim() && draft.baseUrl.trim() && draft.modelName.trim()

  const submit = async (testAfterSave: boolean) => {
    const input: ModelProfileInput = {
      name: draft.name.trim(),
      provider: draft.provider,
      baseUrl: draft.baseUrl.trim(),
      modelName: draft.modelName.trim(),
      enabled: draft.enabled,
    }
    if (draft.apiKey.trim()) input.apiKey = draft.apiKey.trim()
    else if (draft.clearKey) input.apiKey = ""
    setSubmitting(true)
    await onSubmit(input, testAfterSave)
    setSubmitting(false)
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "添加自定义模型" : `编辑模型：${existing?.name}`}</DialogTitle>
          <DialogDescription>
            填写兼容 OpenAI 协议的网关地址。API Key 提交后仅保存在服务端。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (valid && !submitting) void submit(false)
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="model-name-label">显示名称</FieldLabel>
              <Input
                id="model-name-label"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="例如：公司内部 Qwen-VL"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-provider">接口类型</FieldLabel>
              <Select value={draft.provider} onValueChange={(v) => patch({ provider: v as ModelProvider })}>
                <SelectTrigger id="model-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_PROVIDERS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="model-base-url">Base URL</FieldLabel>
              <Input
                id="model-base-url"
                type="url"
                inputMode="url"
                spellCheck={false}
                value={draft.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder="https://host/v1"
                className="font-mono"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-id">模型名称 (Model)</FieldLabel>
              <Input
                id="model-id"
                spellCheck={false}
                autoComplete="off"
                value={draft.modelName}
                onChange={(e) => patch({ modelName: e.target.value })}
                placeholder="gpt-4o / qwen2.5-vl-72b-instruct"
                className="font-mono"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-key">API Key</FieldLabel>
              <Input
                id="model-key"
                name="vigil-model-credential"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={draft.apiKey}
                onChange={(e) => patch({ apiKey: e.target.value, clearKey: false })}
                placeholder={existing?.hasKey ? `已保存 ${existing.keyHint}，留空保持不变` : "sk-xxxxxxxxxxxxxxxx"}
                className="font-mono"
              />
              <FieldDescription>
                本地 / 内网端点可不填 Key。
                {existing?.hasKey && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="text-destructive underline underline-offset-2"
                      onClick={() => patch({ apiKey: "", clearKey: !draft.clearKey })}
                    >
                      {draft.clearKey ? "已标记清除，点击撤销" : "清除已保存的 Key"}
                    </button>
                  </>
                )}
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="model-enabled"
                checked={draft.enabled}
                onCheckedChange={(checked) => patch({ enabled: checked })}
              />
              <FieldLabel htmlFor="model-enabled">启用该模型</FieldLabel>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="button" variant="secondary" disabled={!valid || submitting} onClick={() => submit(true)}>
              保存并测试
            </Button>
            <Button type="submit" disabled={!valid || submitting}>
              {submitting && <Spinner data-icon="inline-start" />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
