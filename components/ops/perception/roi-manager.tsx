"use client"

import * as React from "react"
import { FileText, Pencil, Pentagon, Plus, Radar, Send, ShieldAlert, Siren, Spline, Trash2, Zap } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { useDemoMode } from "@/components/vigil/demo-mode-provider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { RoiAction, RoiZone } from "@/lib/ops/perception-types"
import { cn } from "@/lib/utils"
import { usePerception } from "./perception-provider"
import { RoiDialog } from "./roi-dialog"

type DialogState = { seq: number; zone: RoiZone | null } | null

export function RoiManager() {
  const { selectedLocalVideo } = usePerception()
  if (selectedLocalVideo) return <LocalRoiNotice name={selectedLocalVideo.name} />
  return <LiveRoiManager />
}

function LocalRoiNotice({ name }: { name: string }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-1 border-b px-4 py-3">
        <CardTitle className="text-sm">电子围栏与碰撞检测引擎 (ROI & Collision Engine)</CardTitle>
        <CardDescription className="text-xs">本地录像回放初筛模式</CardDescription>
      </CardHeader>
      <CardContent className="p-4">
        <Alert role="status">
          <Radar />
          <AlertTitle>围栏引擎在本地录像模式下不参与判定</AlertTitle>
          <AlertDescription>
            {name} 是离线录像，没有实时目标追踪与摄像头坐标系。这里改由 Level-1 逐秒运动初筛判定动作区间，
            围栏碰撞只对 CAM-01 ~ CAM-04 实时通道生效。
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}

function LiveRoiManager() {
  const { cameraId, zones, zoneRuntime, updateZone, removeZone, simulateIntrusion, intrusionActive } =
    usePerception()
  const { enabled: demo } = useDemoMode()
  const [dialog, setDialog] = React.useState<DialogState>(null)
  const seq = React.useRef(0)

  const camZones = zones.filter((z) => z.cameraId === cameraId)
  const banner = camZones.map((z) => zoneRuntime[z.id]?.message).find(Boolean)
  const anyBreach = camZones.some((z) => z.enabled && zoneRuntime[z.id]?.breached)

  const openDialog = (zone: RoiZone | null) => {
    seq.current += 1
    setDialog({ seq: seq.current, zone })
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-1 border-b px-4 py-3">
        <CardTitle className="text-sm">电子围栏与碰撞检测引擎 (ROI & Collision Engine)</CardTitle>
        <CardDescription className="text-xs">
          共 {zones.length} 个围栏，当前通道 {cameraId} 启用 {camZones.filter((z) => z.enabled).length} 个。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          {demo && (
            <Button variant="destructive" size="sm" onClick={simulateIntrusion} disabled={intrusionActive}>
              <Zap data-icon="inline-start" />
              {intrusionActive ? "入侵模拟进行中…" : "模拟目标越界入侵 (Simulate Intrusion)"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => openDialog(null)}>
            <Plus data-icon="inline-start" />
            新建围栏
          </Button>
        </div>

        <Alert variant={banner ? "destructive" : "default"} role="status">
          {banner ? <ShieldAlert /> : <Radar />}
          <AlertTitle>{banner ? "BREACHED · 越界已触发" : "围栏引擎运行中"}</AlertTitle>
          <AlertDescription>{banner ?? "目标中心点持续与围栏做碰撞检测，暂无越界。"}</AlertDescription>
        </Alert>

        <ul className="flex flex-col gap-2" aria-label={`${cameraId} 电子围栏列表`}>
          {camZones.length === 0 && (
            <li className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              当前通道尚未配置围栏，点击“新建围栏”开始布控。
            </li>
          )}
          {camZones.map((zone) => {
            const runtime = zoneRuntime[zone.id]
            const breached = zone.enabled && Boolean(runtime?.breached)
            const Icon = zone.type === "polygon" ? Pentagon : Spline
            return (
              <li
                key={zone.id}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border bg-card p-3 transition-colors",
                  breached && "border-destructive bg-destructive/10",
                  !zone.enabled && "opacity-70"
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-md border"
                    style={{ color: zone.color, borderColor: `color-mix(in oklab, ${zone.color} 45%, transparent)` }}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="truncate text-sm font-medium">{zone.name}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={zone.severity === "critical" ? "destructive" : "secondary"}>
                        {zone.severity === "critical" ? "严重" : "预警"}
                      </Badge>
                      <Badge variant="outline">{zone.type === "polygon" ? "多边形" : zone.directional ? "单向绊线" : "绊线"}</Badge>
                      {breached ? (
                        <Badge variant="destructive" className="animate-pulse">
                          BREACHED · 入侵中
                        </Badge>
                      ) : (
                        <Badge variant="outline" className={cn(zone.enabled && "border-success/40 text-success")}>
                          {zone.enabled ? "监控中" : "已停用"}
                        </Badge>
                      )}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        累计触发 {runtime?.count ?? 0} 次
                      </span>
                    </div>
                  </div>
                  <Switch
                    checked={zone.enabled}
                    onCheckedChange={(v) => updateZone(zone.id, { enabled: v })}
                    aria-label={`${zone.enabled ? "停用" : "启用"} ${zone.name}`}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={zone.action}
                    onValueChange={(v) => v && updateZone(zone.id, { action: v as RoiAction })}
                    aria-label="触发动作"
                  >
                    <ToggleGroupItem value="escalate" title="Escalate to Tier-2 VLM (送大模型深度研判)">
                      <Send />
                      送检 VLM
                    </ToggleGroupItem>
                    <ToggleGroupItem value="log" title="Log Only (仅记录日志)">
                      <FileText />
                      仅记录
                    </ToggleGroupItem>
                    <ToggleGroupItem value="siren" title="Audible Siren (声光报警)">
                      <Siren />
                      声光
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => openDialog(zone)} aria-label={`编辑 ${zone.name}`}>
                      <Pencil />
                    </Button>
                    {zone.custom && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeZone(zone.id)}
                        aria-label={`删除 ${zone.name}`}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>

      {dialog && (
        <RoiDialog
          key={dialog.seq}
          open
          zone={dialog.zone}
          onOpenChange={(open) => !open && setDialog(null)}
        />
      )}
    </Card>
  )
}
