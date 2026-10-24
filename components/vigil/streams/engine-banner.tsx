"use client"

import * as React from "react"
import { Download, RotateCw, TriangleAlert } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { EngineInfo } from "@/lib/vigil/streams"

interface EngineBannerProps {
  engine: EngineInfo
  onAction: (action: "install" | "restart") => Promise<EngineInfo | null>
}

/** 引擎正常时不占位；降级时给出原因与一键修复入口。 */
export function EngineBanner({ engine, onAction }: EngineBannerProps) {
  const [busy, setBusy] = React.useState<"install" | "restart" | null>(null)
  if (engine.engineStatus === "running") return null

  const run = async (action: "install" | "restart") => {
    setBusy(action)
    await onAction(action)
    setBusy(null)
  }

  const needInstall = engine.issue === "binary-missing"
  const canRetry = engine.issue !== "unsupported" && engine.issue !== "disabled"

  return (
    <Alert className="border-warning/40 bg-warning/10">
      <TriangleAlert className="text-warning" />
      <AlertTitle className="text-warning">
        {engine.engineStatus === "starting" ? "流媒体引擎启动中" : "流媒体引擎未就绪"}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>{engine.message}</span>
        {canRetry ? (
          <div className="flex flex-wrap gap-2">
            {needInstall ? (
              <Button size="sm" onClick={() => void run("install")} disabled={busy !== null}>
                {busy === "install" ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                {busy === "install" ? "正在下载安装…" : "一键安装引擎"}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void run("restart")} disabled={busy !== null}>
              {busy === "restart" ? <Spinner data-icon="inline-start" /> : <RotateCw data-icon="inline-start" />}
              重启引擎
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
