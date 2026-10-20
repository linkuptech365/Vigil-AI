"use client"

import * as React from "react"
import {
  Check,
  ClipboardList,
  DatabaseZap,
  FileCheck2,
  Megaphone,
  RotateCcw,
  Send,
  ShieldX,
  Workflow,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  FALSE_POSITIVE_REASONS,
  QUICK_ACTION_LABEL,
  RESPONDERS,
  STATUS_ENGLISH,
  STATUS_LABEL,
  STATUS_SHORT_LABEL,
} from "@/lib/ops/dispatch-data"
import type { DossierStatus } from "@/lib/ops/dispatch-types"
import { cn } from "@/lib/utils"
import { DispatchStatusBadge } from "./dispatch-status-badge"
import { useDispatch } from "./dispatch-provider"
import { FalsePositiveDialog } from "./false-positive-dialog"

const FLOW: DossierStatus[] = ["PENDING", "DISPATCHED", "IN_PROGRESS", "RESOLVED"]

function LifecycleStepper({ status }: { status: DossierStatus }) {
  const falsePositive = status === "FALSE_POSITIVE"
  const currentIndex = falsePositive ? -1 : FLOW.indexOf(status)

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="案卷处置生命周期">
        {FLOW.map((step, index) => {
          const done = index < currentIndex || status === "RESOLVED"
          const active = index === currentIndex && status !== "RESOLVED"
          return (
            <li key={step} className="flex items-center gap-1">
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                  done && "border-success/40 bg-success/10 text-success",
                  active && "border-primary bg-primary/15 text-foreground",
                  !done && !active && "border-border text-muted-foreground",
                  falsePositive && "opacity-50"
                )}
              >
                {done ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      active ? "bg-primary" : "bg-muted-foreground/50"
                    )}
                    aria-hidden="true"
                  />
                )}
                {STATUS_SHORT_LABEL[step]}
                <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                  {STATUS_ENGLISH[step]}
                </span>
              </span>
              {index < FLOW.length - 1 ? (
                <span className="text-muted-foreground" aria-hidden="true">
                  /
                </span>
              ) : null}
            </li>
          )
        })}
        <li className="flex items-center gap-1">
          <span className="text-muted-foreground" aria-hidden="true">
            |
          </span>
          <span
            aria-current={falsePositive ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
              falsePositive
                ? "border-input bg-secondary text-foreground"
                : "border-border text-muted-foreground"
            )}
          >
            <ShieldX className="size-3.5" aria-hidden="true" />
            标记误报
            <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
              False Positive
            </span>
          </span>
        </li>
      </ol>
    </div>
  )
}

export function IncidentWorkflow() {
  const {
    dossier,
    actions,
    feedback,
    responderId,
    setResponderId,
    assignedResponderId,
    dispatchToResponder,
    runQuickAction,
    resetDemo,
  } = useDispatch()
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)

  const status = dossier.status
  const closed = status === "RESOLVED" || status === "FALSE_POSITIVE"
  const canDispatch = status === "PENDING"
  const canAct = status === "DISPATCHED" || status === "IN_PROGRESS"
  const canSignOff = status === "IN_PROGRESS"
  const assigned = RESPONDERS.find((r) => r.id === assignedResponderId)

  const hint = (() => {
    switch (status) {
      case "PENDING":
        return "先选择责任人并派工，才能执行处置动作。"
      case "DISPATCHED":
        return "已派工。执行喊话或整改单后进入处置中，才可签收结案。"
      case "IN_PROGRESS":
        return "处置中。现场确认隐患消除后，可一键签收结案并归档。"
      case "RESOLVED":
        return "案卷已结案并归档，不可再修改处置结果。"
      case "FALSE_POSITIVE":
        return STATUS_LABEL.FALSE_POSITIVE
    }
  })()

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Workflow className="size-4 text-signal" aria-hidden="true" />
          闭环处置工作流 (Closed-Loop Incident Workflow)
        </CardTitle>
        <CardDescription>
          从派工、现场处置到结案归档，或把误报回流为模型微调样本。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <LifecycleStepper status={status} />
          <DispatchStatusBadge status={status} />
        </div>
        <p
          className="rounded-md border border-border bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          role="status"
        >
          {hint}
        </p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-3" aria-labelledby="dispatch-panel-title">
            <h4 id="dispatch-panel-title" className="flex items-center gap-1.5 text-sm font-medium">
              <ClipboardList className="size-4 text-muted-foreground" aria-hidden="true" />
              派工面板
            </h4>
            <Field>
              <FieldLabel htmlFor="responder-select">现场责任人</FieldLabel>
              <Select
                value={responderId}
                onValueChange={setResponderId}
                disabled={!canDispatch}
              >
                <SelectTrigger id="responder-select" className="w-full">
                  <SelectValue placeholder="选择责任人" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {RESPONDERS.map((responder) => (
                      <SelectItem key={responder.id} value={responder.id}>
                        {responder.name} ({responder.role})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {assigned ? (
              <p className="text-xs text-muted-foreground">
                当前责任人：
                <span className="text-foreground">
                  {assigned.name} ({assigned.role})
                </span>
              </p>
            ) : null}
            <Button type="button" onClick={dispatchToResponder} disabled={!canDispatch}>
              <Send data-icon="inline-start" />
              确认派工
            </Button>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="quick-action-title">
            <h4 id="quick-action-title" className="flex items-center gap-1.5 text-sm font-medium">
              <Megaphone className="size-4 text-muted-foreground" aria-hidden="true" />
              快捷处置动作
            </h4>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                disabled={!canAct}
                onClick={() => runQuickAction("VOICE_INTERCOM")}
              >
                <Megaphone data-icon="inline-start" />
                {QUICK_ACTION_LABEL.VOICE_INTERCOM} (Voice Intercom Broadcast)
              </Button>
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                disabled={!canAct}
                onClick={() => runQuickAction("RECTIFICATION_ORDER")}
              >
                <FileCheck2 data-icon="inline-start" />
                {QUICK_ACTION_LABEL.RECTIFICATION_ORDER} (Issue Rectification Order)
              </Button>
              <Button
                type="button"
                className="justify-start"
                disabled={!canSignOff}
                onClick={() => runQuickAction("SIGN_OFF")}
              >
                <Check data-icon="inline-start" />
                {QUICK_ACTION_LABEL.SIGN_OFF} (Sign-off & Resolve)
              </Button>
            </div>
          </section>
        </div>

        <Separator />

        <section className="flex flex-col gap-3" aria-labelledby="feedback-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <h4 id="feedback-title" className="flex items-center gap-1.5 text-sm font-medium">
                <DatabaseZap className="size-4 text-muted-foreground" aria-hidden="true" />
                模型反馈与主动学习闭环 (Active Learning Loop)
              </h4>
              <p className="text-xs text-muted-foreground">
                误报样本会连同画面与研判输出进入微调数据集。
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                onClick={() => setFeedbackOpen(true)}
                disabled={closed}
              >
                <ShieldX data-icon="inline-start" />
                标记为大模型误报 (Mark False Positive)
              </Button>
              <Button type="button" variant="ghost" onClick={resetDemo}>
                <RotateCcw data-icon="inline-start" />
                重置演示
              </Button>
            </div>
          </div>
          {feedback ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-success/50 text-success">
                  Dataset Exported
                </Badge>
                <span className="font-medium">{FALSE_POSITIVE_REASONS[feedback.reason]}</span>
                <span className="font-mono text-xs text-muted-foreground">{feedback.submittedAt}</span>
              </div>
              {feedback.explanation ? (
                <p className="text-xs leading-relaxed text-muted-foreground">{feedback.explanation}</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <Separator />

        <section className="flex flex-col gap-2" aria-labelledby="action-log-title">
          <h4 id="action-log-title" className="text-sm font-medium">
            处置操作日志 ({actions.length})
          </h4>
          <ol className="scrollbar-thin flex max-h-56 flex-col gap-2 overflow-y-auto pr-1" aria-label="处置操作日志">
            {actions.map((action) => (
              <li
                key={action.id}
                className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium">{action.actionType}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {action.timestamp} · {action.id}
                  </span>
                </div>
                <span className="text-[11px] text-signal">{action.operator}</span>
                <p className="text-xs leading-relaxed text-muted-foreground">{action.notes}</p>
              </li>
            ))}
          </ol>
        </section>
      </CardContent>
      <FalsePositiveDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </Card>
  )
}
