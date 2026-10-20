"use client"

import * as React from "react"
import { Eye, EyeOff, KeyRound, Lock, Pencil, ShieldCheck, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { useVigil } from "../vigil-provider"

const MASK_DOTS = "•".repeat(24)

export function ApiKeyField() {
  const { apiKey, setApiKey } = useVigil()
  const [locked, setLocked] = React.useState(false)
  const [reveal, setReveal] = React.useState(false)

  const hasKey = apiKey.trim().length > 0

  const lock = React.useCallback(() => {
    if (!apiKey.trim()) return
    setReveal(false)
    setLocked(true)
  }, [apiKey])

  const clear = () => {
    setApiKey("")
    setReveal(false)
    setLocked(false)
  }

  if (locked && hasKey) {
    const prefix = apiKey.startsWith("sk-") ? "sk-" : ""
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-success/30 bg-success/5 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <ShieldCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
          <span className="truncate font-mono text-sm" aria-label="API Key 已安全隐藏">
            {prefix}
            {MASK_DOTS}
          </span>
          <span className="shrink-0 text-xs font-medium text-success">[已安全隐藏]</span>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setLocked(false)}>
            <Pencil data-icon="inline-start" />
            重新编辑
          </Button>
          <Button variant="outline" size="sm" onClick={clear}>
            <Trash2 data-icon="inline-start" />
            清除
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col gap-2 sm:flex-row"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) lock()
      }}
    >
      <InputGroup className="flex-1">
        <InputGroupAddon>
          <KeyRound aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          id="api-key"
          name="vigil-model-credential"
          type={reveal ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-xxxxxxxxxxxxxxxx"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              lock()
            }
          }}
          className="font-mono"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={reveal ? "隐藏密钥" : "显示密钥"}
            aria-pressed={reveal}
            onClick={() => setReveal((v) => !v)}
          >
            {reveal ? <EyeOff /> : <Eye />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <Button variant="secondary" onClick={lock} disabled={!hasKey}>
        <Lock data-icon="inline-start" />
        脱敏锁定
      </Button>
    </div>
  )
}
