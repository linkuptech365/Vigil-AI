"use client"

import * as React from "react"
import useSWR from "swr"
import { toast } from "sonner"

import type { CreateRuleResponse, RulesListResponse, UpdateRuleResponse } from "@/lib/ops/rules-api-types"
import { RULES_ENDPOINT, errorMessage, getJson, sendJson } from "@/lib/ops/rules-client"
import { INITIAL_INSPECTION_RULES } from "@/lib/ops/rules-data"
import type { InspectionRule, RuleActionKey } from "@/lib/ops/rules-types"
import { loadStoredRules, saveStoredRules } from "@/lib/ops/storage/audit-storage"

export interface CustomRuleInput {
  name: string
  prompt: string
  sensitivity: number
  actions: Record<RuleActionKey, boolean>
}

const PATCH_KEYS = ["enabled", "severity", "cooldownSeconds", "schedule", "boundChannels", "sensitivity", "actions"] as const

/** 服务端内存在冷启动后会重置，这里把浏览器里保存的规则改动回放到服务端。 */
async function restoreRulesFromStorage(server: InspectionRule[]) {
  const stored = loadStoredRules()
  if (!stored || stored.length === 0) return null
  let touched = false

  for (const saved of stored) {
    const live = server.find((rule) => rule.id === saved.id)
    if (live) {
      const patch: Record<string, unknown> = {}
      for (const key of PATCH_KEYS) {
        if (saved[key] !== undefined && JSON.stringify(saved[key]) !== JSON.stringify(live[key])) {
          patch[key] = saved[key]
        }
      }
      if (Object.keys(patch).length === 0) continue
      try {
        await sendJson<UpdateRuleResponse>(`${RULES_ENDPOINT}/${live.id}`, "PATCH", patch)
        touched = true
      } catch {
        continue
      }
    } else if (saved.custom && saved.prompt && !server.some((rule) => rule.custom && rule.name === saved.name)) {
      try {
        await sendJson<CreateRuleResponse>(RULES_ENDPOINT, "POST", {
          name: saved.name,
          prompt: saved.prompt,
          sensitivity: saved.sensitivity ?? 0.8,
          actions: saved.actions ?? { webhook: true, dispatch: true, siren: false },
        })
        touched = true
      } catch {
        continue
      }
    }
  }
  return touched ? await getJson<RulesListResponse>(RULES_ENDPOINT) : null
}

let restoreState: "idle" | "running" | "done" = "idle"

/**
 * 服务端规则库的唯一客户端入口。顶部「规则工作室」弹窗与「规则与防抖引擎」标签页
 * 共用同一个 SWR 键，任何一处的修改都会立即同步到另一处，并持久化到浏览器存储。
 */
export function useServerRules() {
  const { data, error, mutate } = useSWR<RulesListResponse>(RULES_ENDPOINT, getJson)
  const rules = data?.rules ?? INITIAL_INSPECTION_RULES

  React.useEffect(() => {
    if (!data) return
    if (restoreState === "done") {
      saveStoredRules(data.rules)
      return
    }
    if (restoreState === "running") return
    restoreState = "running"
    restoreRulesFromStorage(data.rules)
      .then((restored) => {
        if (restored) {
          saveStoredRules(restored.rules)
          void mutate(restored, { revalidate: false })
        } else {
          saveStoredRules(data.rules)
        }
      })
      .catch(() => saveStoredRules(data.rules))
      .finally(() => {
        restoreState = "done"
      })
  }, [data, mutate])

  const updateRule = React.useCallback(
    async (id: string, patch: Partial<InspectionRule>) => {
      try {
        await mutate(
          async () => {
            const response = await sendJson<UpdateRuleResponse>(`${RULES_ENDPOINT}/${id}`, "PATCH", patch)
            return { rules: response.rules }
          },
          {
            optimisticData: (current) => ({
              rules: (current?.rules ?? INITIAL_INSPECTION_RULES).map((rule) =>
                rule.id === id ? { ...rule, ...patch } : rule
              ),
            }),
            rollbackOnError: true,
            populateCache: true,
            revalidate: false,
          }
        )
      } catch (caught) {
        toast.error("规则更新失败，已回滚", { description: errorMessage(caught) })
      }
    },
    [mutate]
  )

  const addCustomRule = React.useCallback(
    async (input: CustomRuleInput) => {
      try {
        const response = await sendJson<CreateRuleResponse>(RULES_ENDPOINT, "POST", input)
        await mutate({ rules: response.rules }, { revalidate: false })
        toast.success("自定义语义规则已创建并启用", {
          description: `${response.rule.id} 已写入服务端规则库，默认绑定全部通道，可在规则目录中继续调整。`,
        })
        return true
      } catch (caught) {
        toast.error("规则创建失败", { description: errorMessage(caught) })
        return false
      }
    },
    [mutate]
  )

  return { rules, rulesError: Boolean(error), updateRule, addCustomRule }
}
