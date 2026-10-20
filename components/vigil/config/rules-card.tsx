"use client"

import { Radar } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { RULES, RULE_IDS } from "@/lib/vigil/rules"
import { useVigil } from "../vigil-provider"
import { SeverityBadge } from "../status-badges"

export function RulesCard() {
  const { settings, updateSettings } = useVigil()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radar className="size-4 text-primary" aria-hidden="true" />
          预警规则启用
        </CardTitle>
        <CardDescription>仅对已启用的场景下发识别指令并产生预警。</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {RULE_IDS.map((id) => {
            const rule = RULES[id]
            return (
              <li key={id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor={`rule-${id}`} className="cursor-pointer text-sm font-medium">
                      {rule.scenarioLabel}
                    </label>
                    <SeverityBadge severity={rule.severity} />
                  </div>
                  <p className="text-xs text-muted-foreground">{rule.scenarioHint}</p>
                </div>
                <Switch
                  id={`rule-${id}`}
                  checked={settings.rules[id]}
                  onCheckedChange={(checked) =>
                    updateSettings({ rules: { ...settings.rules, [id]: checked } })
                  }
                />
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
