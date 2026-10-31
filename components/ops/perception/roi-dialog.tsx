"use client"

import * as React from "react"
import { FileText, Pentagon, Send, Siren, Spline } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useDemoMode } from "@/components/vigil/demo-mode-provider"
import type { RoiAction, RoiSeverity, RoiShape, RoiZone } from "@/lib/ops/perception-types"
import { usePerception } from "./perception-provider"

interface RoiDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  zone: RoiZone | null
}

export function RoiDialog({ open, onOpenChange, zone }: RoiDialogProps) {
  const { cameraId, zones, addZone, updateZone, startDrawing } = usePerception()
  const { enabled: demo } = useDemoMode()
  const [name, setName] = React.useState(zone?.name ?? "")
  const [type, setType] = React.useState<RoiShape>(zone?.type ?? "polygon")
  const [severity, setSeverity] = React.useState<RoiSeverity>(zone?.severity ?? "critical")
  const [sensitivity, setSensitivity] = React.useState(zone?.sensitivity ?? 70)
  const [action, setAction] = React.useState<RoiAction>(zone?.action ?? "escalate")
  const editing = zone !== null

  const submit = () => {
    const finalName = name.trim() || `自定义围栏 ${zones.filter((z) => z.custom).length + 1}`
    if (zone) {
      updateZone(zone.id, {
        name: finalName,
        severity,
        sensitivity,
        action,
        color: severity === "critical" ? "var(--destructive)" : "var(--warning)",
      })
    } else {
      const input = { name: finalName, type, severity, sensitivity, action }
      if (demo) addZone(input)
      else startDrawing(input)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑电子围栏" : "新建电子围栏"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "调整围栏的等级、灵敏度与触发动作；位置请用列表里的“调整位置”在画面上拖动。"
              : demo
                ? `围栏将在 ${cameraId} 画面中央生成，可随后微调参数。`
                : `确认参数后，在 ${cameraId} 的实时画面上点击绘制围栏位置。`}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="roi-name">围栏名称</FieldLabel>
            <Input
              id="roi-name"
              value={name}
              placeholder="例如：配电房禁入区"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel>围栏形状 (Shape)</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={type}
              disabled={editing}
              onValueChange={(v) => v && setType(v as RoiShape)}
            >
              <ToggleGroupItem value="polygon" aria-label="多边形区域">
                <Pentagon />
                多边形区域
              </ToggleGroupItem>
              <ToggleGroupItem value="tripwire" aria-label="绊线">
                <Spline />
                绊线 (Tripwire)
              </ToggleGroupItem>
            </ToggleGroup>
            {editing && <FieldDescription>已有围栏的几何形状不可更改。</FieldDescription>}
          </Field>

          <Field>
            <FieldLabel>严重等级</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={severity}
              onValueChange={(v) => v && setSeverity(v as RoiSeverity)}
            >
              <ToggleGroupItem value="warning">预警 Warning</ToggleGroupItem>
              <ToggleGroupItem value="critical">严重 Critical</ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="roi-sensitivity">报警灵敏度</FieldLabel>
              <span className="font-mono text-sm tabular-nums">{sensitivity}</span>
            </div>
            <Slider
              id="roi-sensitivity"
              min={10}
              max={100}
              step={5}
              value={[sensitivity]}
              onValueChange={(v) => setSensitivity(v[0])}
            />
            <FieldDescription>数值越高，重复触发的冷却时间越短。</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>触发动作 (Action)</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={action}
              onValueChange={(v) => v && setAction(v as RoiAction)}
            >
              <ToggleGroupItem value="escalate">
                <Send />
                送检 VLM
              </ToggleGroupItem>
              <ToggleGroupItem value="log">
                <FileText />
                仅记录
              </ToggleGroupItem>
              <ToggleGroupItem value="siren">
                <Siren />
                声光报警
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit}>{editing ? "保存修改" : demo ? "创建并启用" : "下一步：画面上绘制"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
