import { createHash } from "node:crypto"
import JSZip from "jszip"

import { getAlert, readEvidenceFrame, verifyEvidence } from "@/lib/storage/streams-store"
import { CASE_STATUS_LABEL } from "@/lib/vigil/streams"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function report(alertId: string) {
  const alert = getAlert(alertId)
  if (!alert) return null
  const integrity = verifyEvidence(alert)
  const line = "=".repeat(60)
  const rows = [
    line,
    "Vigil-AI 视频研判证据档案",
    line,
    `案卷编号：${alert.case?.caseId ?? "-"}`,
    `告警编号：${alert.id}`,
    `监控通道：${alert.streamName}（${alert.zone}）`,
    `触发时间：${alert.triggeredAt}`,
    `命中规则：${alert.ruleName}（${alert.severity}，置信度 ${alert.confidence}%）`,
    `案卷状态：${alert.case ? CASE_STATUS_LABEL[alert.case.status] : "-"}`,
    `研判模型：${alert.model}（${alert.engineSource}）`,
    `证据完整性：${integrity.ok ? "校验通过" : "校验未通过"}（${integrity.checkedAt}）`,
    "",
    "一、研判结论",
    alert.summary,
    "",
    "二、推理依据",
    alert.reasoning,
    "",
    "三、处置建议",
    alert.advice,
    "",
    "四、证据帧",
    ...(alert.seal?.files ?? []).map((f) => `${f.name}  ${f.bytes} bytes  SHA-256 ${f.sha256}`),
    "",
    "五、处置记录（由旧到新）",
    ...[...(alert.case?.actions ?? [])].reverse().map((a) => `${a.at}  ${a.operator}  ${a.actionType}：${a.notes}`),
    "",
    "六、联动渠道",
    ...(alert.case?.linkage ?? []).map((l) => `${l.name}：${l.status}${l.detail ? `（${l.detail}）` : ""}`),
    "",
    "校验方式：对 frames 目录内各文件计算 SHA-256，应与 manifest.json 中 files 一致。",
    line,
  ]
  return { alert, integrity, text: rows.join("\n") }
}

export async function GET(_request: Request, { params }: { params: Promise<{ alertId: string }> }) {
  const { alertId } = await params
  const built = report(alertId)
  if (!built) return Response.json({ status: "error", message: "告警不存在或已过保留期被清理", error: "ALERT_NOT_FOUND" }, { status: 404 })
  const { alert, integrity, text } = built

  const zip = new JSZip()
  for (const file of alert.seal?.files ?? []) {
    const index = Number.parseInt(file.name, 10)
    const buffer = readEvidenceFrame(alert.id, index)
    if (buffer) zip.file(`frames/${file.name}`, buffer)
  }
  const manifest = {
    format: "vigil-evidence-archive/1",
    generatedAt: new Date().toISOString(),
    integrity,
    seal: alert.seal,
    alert,
  }
  zip.file("manifest.json", JSON.stringify(manifest, null, 2))
  zip.file("EVIDENCE_REPORT.txt", text)
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
  const digest = createHash("sha256").update(buffer).digest("hex")
  const fileName = `EVIDENCE_${alert.case?.caseId ?? alert.id}.zip`

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "X-Archive-SHA256": digest,
      "X-Archive-File-Name": fileName,
      "Cache-Control": "no-store",
    },
  })
}
