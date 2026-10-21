"use client"

import { RotateCcw, Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { InspectionRule } from "@/lib/ops/rules-types"

export function DeleteRuleButton({
  rule,
  onDelete,
}: {
  rule: InspectionRule
  onDelete: (id: string) => Promise<boolean>
}) {
  if (!rule.custom) return null

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          aria-label={`删除规则 ${rule.name}`}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除这条自定义规则？</AlertDialogTitle>
          <AlertDialogDescription>
            {rule.id} 将从本地规则库中永久移除，已产生的告警记录不受影响。内置规则不能删除，只能停用。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void onDelete(rule.id)}>
            确认删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ResetRulesButton({ onReset }: { onReset: () => Promise<boolean> }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <RotateCcw data-icon="inline-start" />
          恢复出厂规则
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>恢复出厂规则？</AlertDialogTitle>
          <AlertDialogDescription>
            规则库会重置为内置规则：所有自定义规则被删除，内置规则的启用状态、灵敏度、绑定范围等修改也会还原。此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void onReset()}>
            确认恢复
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
