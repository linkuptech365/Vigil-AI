import { NextResponse } from "next/server"

import { fireLinkage } from "@/lib/ops/server/alert-linkage"
import { appendCaseAction, getAlert, verifyEvidence } from "@/lib/storage/streams-store"
import { CASE_STATUS_LABEL, type CaseStatus, type FalsePositiveReasonCode } from "@/lib/vigil/streams"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FALSE_POSITIVE_LABEL: Record<FalsePositiveReasonCode, string> = {
  LIGHT_CHANGE: "光线 / 反光变化",
  OCCLUSION: "遮挡导致误判",
  OBJECT_MISJUDGED: "物体 / 动作误识别",
  OTHER: "其他",
}

const QUICK_ACTIONS = {
  VOICE_INTERCOM: { label: "现场喊话", notes: "已通过现场广播向相关人员喊话，要求立即停止违规行为。" },
  RECTIFICATION_ORDER: { label: "下发整改单", notes: "已向责任部门下发《安全隐患整改单》，要求限期提交整改回执。" },
} as const

const NO_STORE = { "Cache-Control": "no-store" }

function fail(message: string, error: string, status: number) {
  return NextResponse.json({ status: "error", message, error }, { status, headers: NO_STORE })
}

export async function GET(_request: Request, { params }: { params: Promise<{ alertId: string }> }) {
  const { alertId } = await params
  const alert = getAlert(alertId)
  if (!alert) return fail("告警不存在或已过保留期被清理", "ALERT_NOT_FOUND", 404)
  return NextResponse.json({ status: "success", alert, integrity: verifyEvidence(alert) }, { headers: NO_STORE })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ alertId: string }> }) {
  const { alertId } = await params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const op = typeof body?.op === "string" ? body.op : ""
  const operator = typeof body?.operator === "string" && body.operator.trim() ? body.operator.trim().slice(0, 40) : "值班调度员"

  const alert = getAlert(alertId)
  if (!alert?.case) return fail("告警不存在或已过保留期被清理", "ALERT_NOT_FOUND", 404)
  const status: CaseStatus = alert.case.status
  const closed = status === "RESOLVED" || status === "FALSE_POSITIVE"
  const now = new Date().toISOString()

  if (op === "broadcast") {
    await fireLinkage(alertId, { force: true, operator })
    return NextResponse.json({ status: "success", alert: getAlert(alertId) }, { headers: NO_STORE })
  }

  if (closed) return fail(`案卷已${CASE_STATUS_LABEL[status]}，不能再变更`, "CASE_CLOSED", 409)

  switch (op) {
    case "ack": {
      if (status !== "PENDING") return fail("仅待处置的案卷可以确认", "BAD_STATE", 409)
      appendCaseAction(alertId, { operator, actionType: "确认告警", notes: "已确认收到该告警，进入处置流程。" }, { status: "ACKED" })
      break
    }
    case "dispatch": {
      if (status !== "PENDING" && status !== "ACKED") return fail("案卷已派工，不能重复派工", "BAD_STATE", 409)
      const responder = typeof body?.responder === "string" ? body.responder.trim().slice(0, 40) : ""
      if (!responder) return fail("请填写处置责任人", "BAD_BODY", 400)
      appendCaseAction(alertId, { operator, actionType: "派工", notes: `已将案卷派发至 ${responder}，等待现场确认接单。` }, { status: "DISPATCHED", responder })
      break
    }
    case "action": {
      const type = typeof body?.actionType === "string" ? body.actionType : ""
      if (type !== "VOICE_INTERCOM" && type !== "RECTIFICATION_ORDER") return fail("未知的处置动作", "BAD_BODY", 400)
      if (status !== "DISPATCHED" && status !== "IN_PROGRESS") return fail("请先派工，再执行处置动作", "BAD_STATE", 409)
      const quick = QUICK_ACTIONS[type]
      appendCaseAction(alertId, { operator: alert.case.responder ?? operator, actionType: quick.label, notes: quick.notes }, { status: "IN_PROGRESS" })
      break
    }
    case "sign_off": {
      if (status !== "IN_PROGRESS") return fail("需要先执行至少一项处置动作才能结案", "BAD_STATE", 409)
      appendCaseAction(
        alertId,
        { operator: alert.case.responder ?? operator, actionType: "签收结案", notes: "现场确认隐患已消除，案卷签收结案；证据保留至保留期结束。" },
        { status: "RESOLVED", closedAt: now }
      )
      break
    }
    case "false_positive": {
      const reason = body?.reason as FalsePositiveReasonCode
      if (!(reason in FALSE_POSITIVE_LABEL)) return fail("请选择误报原因", "BAD_BODY", 400)
      const explanation = typeof body?.explanation === "string" ? body.explanation.trim().slice(0, 300) : ""
      appendCaseAction(
        alertId,
        {
          operator,
          actionType: "标记大模型误报",
          notes: `原因：${FALSE_POSITIVE_LABEL[reason]}${explanation ? `；说明：${explanation}` : ""}。样本已标记，可用于阈值校准。`,
        },
        { status: "FALSE_POSITIVE", closedAt: now, falsePositive: { reason, explanation, submittedAt: now } }
      )
      break
    }
    default:
      return fail("未知操作", "BAD_BODY", 400)
  }
  return NextResponse.json({ status: "success", alert: getAlert(alertId) }, { headers: NO_STORE })
}
