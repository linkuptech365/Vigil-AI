"use client"

import * as React from "react"
import useSWR from "swr"
import { toast } from "sonner"

import type {
  CreateRuleResponse,
  DeleteRuleResponse,
  RulesListResponse,
  UpdateRuleResponse,
} from "@/lib/ops/rules-api-types"
import { RULES_ENDPOINT, errorMessage, getJson, sendJson } from "@/lib/ops/rules-client"
import type { InspectionRule, RuleActionKey } from "@/lib/ops/rules-types"
import { loadStoredRules, saveStoredRules } from "@/lib/ops/storage/audit-storage"

export interface CustomRuleInput {
  name: string
  prompt: string
  sensitivity: number
  actions: Record<RuleActionKey, boolean>
  boundChannels?: string[]
}

const NO_RULES: InspectionRule[] = []

/** description 是 VLM 语义判定依据：语义规则落到 prompt，确定性规则落到 logic。 */
export type RulePatch = Partial<InspectionRule> & { description?: string }

function applyPatch(rule: InspectionRule, patch: RulePatch): InspectionRule {
  const { description, ...rest } = patch
  const next = { ...rule, ...rest }
  if (description !== undefined) {
    if (rule.type === "PROMPT_SEMANTIC") next.prompt = description
    else next.logic = description
  }
  return next
}

const SAVED_TOAST_ID = "rules-saved"

function notifySaved() {
  toast.success("已保存至本地规则库", { id: SAVED_TOAST_ID, duration: 1500 })
}

/**
 * 服务端规则库（data/rules.json）的唯一客户端入口。
 * 页面加载时以服务端为准；localStorage 只是离线时的渲染缓存，绝不会反向覆盖服务端。
 * 顶部「规则工作室」弹窗与「规则与防抖引擎」标签页共用同一个 SWR 键，任何一处修改即时同步到另一处。
 */
export function useServerRules() {
  const { data, error, mutate } = useSWR<RulesListResponse>(RULES_ENDPOINT, getJson)
  const [cached, setCached] = React.useState<InspectionRule[] | null>(null)

  React.useEffect(() => {
    setCached(loadStoredRules())
  }, [])

  React.useEffect(() => {
    if (data) saveStoredRules(data.rules)
  }, [data])

  const rules = data?.rules ?? cached ?? NO_RULES

  const updateRule = React.useCallback(
    async (id: string, patch: RulePatch) => {
      try {
        await mutate(
          async () => {
            const response = await sendJson<UpdateRuleResponse>(`${RULES_ENDPOINT}/${id}`, "PUT", patch)
            return { rules: response.rules }
          },
          {
            optimisticData: (current) => ({
              rules: (current?.rules ?? NO_RULES).map((rule) =>
                rule.id === id ? applyPatch(rule, patch) : rule
              ),
            }),
            rollbackOnError: true,
            populateCache: true,
            revalidate: false,
          }
        )
        notifySaved()
      } catch (caught) {
        toast.error("规则保存失败，已回滚", { description: errorMessage(caught) })
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
          description: `${response.rule.id} 已保存至本地规则库，重启或更新代码后不会丢失。`,
        })
        return true
      } catch (caught) {
        toast.error("规则创建失败", { description: errorMessage(caught) })
        return false
      }
    },
    [mutate]
  )

  const deleteRule = React.useCallback(
    async (id: string) => {
      try {
        await mutate(
          async () => {
            const response = await sendJson<DeleteRuleResponse>(`${RULES_ENDPOINT}/${id}`, "DELETE")
            return { rules: response.rules }
          },
          {
            optimisticData: (current) => ({
              rules: (current?.rules ?? NO_RULES).filter((rule) => rule.id !== id),
            }),
            rollbackOnError: true,
            populateCache: true,
            revalidate: false,
          }
        )
        toast.success("规则已删除", { description: `${id} 已从本地规则库移除。` })
        return true
      } catch (caught) {
        toast.error("规则删除失败", { description: errorMessage(caught) })
        return false
      }
    },
    [mutate]
  )

  const resetRules = React.useCallback(async () => {
    try {
      const response = await sendJson<RulesListResponse>(`${RULES_ENDPOINT}/reset`, "POST")
      await mutate({ rules: response.rules }, { revalidate: false })
      toast.success("已恢复出厂规则", {
        description: `规则库已重置为 ${response.rules.length} 条内置规则，自定义规则已清除。`,
      })
      return true
    } catch (caught) {
      toast.error("恢复出厂规则失败", { description: errorMessage(caught) })
      return false
    }
  }, [mutate])

  const loadGmpPreset = React.useCallback(async () => {
    try {
      const response = await sendJson<RulesListResponse>(`${RULES_ENDPOINT}/preset/gmp`, "POST")
      await mutate({ rules: response.rules }, { revalidate: false })
      toast.success("已载入 GMP 洁净室标准预设", {
        description: "防护穿戴、行为姿态、无菌操作 3 条规则已启用并保存。",
      })
      return true
    } catch (caught) {
      toast.error("载入 GMP 预设失败", { description: errorMessage(caught) })
      return false
    }
  }, [mutate])

  return { rules, rulesError: Boolean(error), updateRule, addCustomRule, deleteRule, resetRules, loadGmpPreset }
}
