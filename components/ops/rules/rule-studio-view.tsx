"use client"

import * as React from "react"
import { Plus, SearchX } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SCOPE_BINDINGS, SOURCE_ALL, bindingLabel } from "@/lib/ops/rule-binding"
import { ALL_CHANNELS } from "@/lib/ops/rules-data"
import type { InspectionRule } from "@/lib/ops/rules-types"
import { CustomRuleDialog } from "./custom-rule-dialog"
import { LoadGmpPresetButton, ResetRulesButton } from "./rule-danger-actions"
import { RuleCard } from "./rule-card"
import { useRules } from "./rules-provider"

type RuleFilter = "all" | "enabled" | "semantic" | "deterministic"

const ALL_CHANNELS_VALUE = "__all_channels__"

const isSemantic = (rule: InspectionRule) => rule.type === "PROMPT_SEMANTIC"

function appliesToChannel(rule: InspectionRule, channel: string) {
  return rule.boundChannels.includes(SOURCE_ALL) || rule.boundChannels.includes(channel)
}

function StatTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex min-w-24 flex-1 flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-lg font-semibold leading-none">{value}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </div>
  )
}

export function RuleStudioView() {
  const { rules, setCustomDialogOpen, resetRules, loadGmpPreset } = useRules()
  const [filter, setFilter] = React.useState<RuleFilter>("all")
  const [channel, setChannel] = React.useState(ALL_CHANNELS_VALUE)

  const counts = React.useMemo(() => {
    const enabled = rules.filter((rule) => rule.enabled).length
    const semantic = rules.filter(isSemantic).length
    return {
      total: rules.length,
      enabled,
      disabled: rules.length - enabled,
      semantic,
      deterministic: rules.length - semantic,
    }
  }, [rules])

  const channelOptions = React.useMemo(() => {
    const extra = rules
      .flatMap((rule) => rule.boundChannels)
      .filter((id) => !SCOPE_BINDINGS.includes(id) && !ALL_CHANNELS.includes(id))
    return [...ALL_CHANNELS, ...Array.from(new Set(extra)).sort()]
  }, [rules])

  const visibleRules = React.useMemo(
    () =>
      rules.filter((rule) => {
        if (filter === "enabled" && !rule.enabled) return false
        if (filter === "semantic" && !isSemantic(rule)) return false
        if (filter === "deterministic" && isSemantic(rule)) return false
        if (channel !== ALL_CHANNELS_VALUE && !appliesToChannel(rule, channel)) return false
        return true
      }),
    [rules, filter, channel]
  )

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-sm">混合规则工作室 (Hybrid Rule Studio)</CardTitle>
            <CardDescription>几何/阈值规则由一级引擎确定性判定，语义规则由大模型按 Prompt 研判。</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LoadGmpPresetButton onLoad={loadGmpPreset} />
            <ResetRulesButton onReset={resetRules} />
            <Button type="button" size="sm" onClick={() => setCustomDialogOpen(true)}>
              <Plus data-icon="inline-start" />
              新建自然语言规则
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="规则统计">
          <StatTile label="规则总数" value={counts.total} />
          <StatTile label="已启用" value={counts.enabled} hint={`/ 停用 ${counts.disabled}`} />
          <StatTile label="确定性规则" value={counts.deterministic} />
          <StatTile label="VLM 语义规则" value={counts.semantic} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as RuleFilter)}>
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="all">全部 ({counts.total})</TabsTrigger>
              <TabsTrigger value="enabled">已启用 ({counts.enabled})</TabsTrigger>
              <TabsTrigger value="semantic">VLM 语义研判 ({counts.semantic})</TabsTrigger>
              <TabsTrigger value="deterministic">确定性/几何引擎 ({counts.deterministic})</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="w-40" aria-label="按通道过滤规则">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_CHANNELS_VALUE}>全部通道</SelectItem>
                {channelOptions.map((id) => (
                  <SelectItem key={id} value={id}>
                    {bindingLabel(id)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {channel !== ALL_CHANNELS_VALUE && (
          <p className="text-[11px] text-muted-foreground">
            显示绑定 {channel} 或「全部视频源」的规则，共 {visibleRules.length} 条
          </p>
        )}

        {visibleRules.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {visibleRules.map((rule) => (
              <RuleCard key={rule.id} rule={rule} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
            <SearchX className="size-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">没有符合当前过滤条件的规则</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFilter("all")
                setChannel(ALL_CHANNELS_VALUE)
              }}
            >
              清除过滤
            </Button>
          </div>
        )}
      </CardContent>
      <CustomRuleDialog />
    </Card>
  )
}
