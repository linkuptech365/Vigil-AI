"use client"

import * as React from "react"
import useSWR from "swr"
import { toast } from "sonner"

import type { CreateRuleResponse, RulesListResponse, UpdateRuleResponse } from "@/lib/ops/rules-api-types"
import { RULES_ENDPOINT, errorMessage, getJson, sendJson } from "@/lib/ops/rules-client"
import { INITIAL_INSPECTION_RULES } from "@/lib/ops/rules-data"
import type { InspectionRule, RuleActionKey } from "@/lib/ops/rules-types"

export interface CustomRuleInput {
  name: string
  prompt: string
  sensitivity: number
  actions: Record<RuleActionKey, boolean>
}

/**
 * 服务端规则库的唯一客户端入口。顶部「规则工作室」弹窗与「规则与防抖引擎」标签页
 * 共用同一个 SWR 键，任何一处的修改都会立即同步到另一处。
 */
export function useServerRules() {
  const { data, error, mutate } = useSWR<RulesListResponse>(RULES_ENDPOINT, getJson)
  const rules = data?.rules ?? INITIAL_INSPECTION_RULES

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
