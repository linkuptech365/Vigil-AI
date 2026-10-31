"use client"

import { FlaskConical } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { useDemoMode } from "@/components/vigil/demo-mode-provider"

export function DemoCard() {
  const { enabled, pending, setEnabled } = useDemoMode()

  async function handleChange(next: boolean) {
    try {
      await setEnabled(next)
      toast.success(next ? "已开启演示数据" : "已关闭演示数据，所有页面仅显示真实数据")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "切换失败，请稍后重试")
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="size-4" aria-hidden="true" />
            演示数据
          </CardTitle>
          <Badge variant={enabled ? "secondary" : "outline"}>{enabled ? "演示中" : "仅真实数据"}</Badge>
        </div>
        <CardDescription>
          一键开启或关闭所有页面的模拟数据，包括模拟机位、示例告警、预置规则、示例案卷与检索语料。默认关闭。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-3">
          <label htmlFor="demo-mode-switch" className="flex flex-col gap-0.5 text-sm">
            <span className="font-medium">启用演示数据</span>
            <span className="text-muted-foreground">用于演示或开发预览；生产使用请保持关闭。</span>
          </label>
          <Switch id="demo-mode-switch" checked={enabled} disabled={pending} onCheckedChange={handleChange} />
        </div>
      </CardContent>
    </Card>
  )
}
