"use client"

import { Radar } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useServerRules } from "@/components/ops/rules/use-server-rules"
import { bindingLabel } from "@/lib/ops/rule-binding"
import { SeverityBadge } from "../status-badges"

export function RulesCard() {
  const { rules, updateRule } = useServerRules()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radar className="size-4 text-primary" aria-hidden="true" />
          预警规则启用
        </CardTitle>
        <CardDescription>
          规则来自「规则工作室」中的统一规则库，仅对已启用且绑定到当前视频源的规则下发识别指令。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`rule-${rule.id}`} className="cursor-pointer text-sm font-medium">
                    {rule.name}
                  </label>
                  <SeverityBadge severity={rule.severity} />
                  {rule.boundChannels.map((channel) => (
                    <Badge key={channel} variant="outline" className="font-mono text-xs">
                      {bindingLabel(channel)}
                    </Badge>
                  ))}
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {rule.prompt ?? rule.logic ?? "该规则暂无描述。"}
                </p>
              </div>
              <Switch
                id={`rule-${rule.id}`}
                checked={rule.enabled}
                onCheckedChange={(checked) => void updateRule(rule.id, { enabled: checked })}
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
