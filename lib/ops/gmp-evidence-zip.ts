import { SUMMARY_CAUSAL_CHAIN, SUMMARY_OVERVIEW } from "@/lib/ops/dispatch-data"
import type {
  DispatchAction,
  EvidenceDossier,
  FalsePositiveFeedback,
  KeyframeMeta,
} from "@/lib/ops/dispatch-types"

export interface GmpEvidenceInput {
  dossier: EvidenceDossier
  keyframes: readonly KeyframeMeta[]
  actions: readonly DispatchAction[]
  feedback: FalsePositiveFeedback | null
  falsePositiveLabel: string | null
}

export interface GmpEvidenceArchive {
  fileName: string
  blob: Blob
  sha256: string
  entries: string[]
}

const DEVIATION_CLASS: Record<EvidenceDossier["severity"], string> = {
  CRITICAL: "Critical Deviation（严重偏差）：可能直接影响产品质量或人员/设备安全，需 QA 立即介入",
  WARNING: "Major Deviation（主要偏差）：需在规定时限内完成调查与纠正",
}

const CAPA_ACTIONS = [
  "纠正措施（Correction）：立即疏散越界人员，隔离事发区域，由 QA 评估对在制品与环境状态的影响。",
  "纠正措施（Correction）：核对事发时段的人员进出与更衣记录，确认涉事人员身份与资质。",
  "预防措施（Prevention）：复核现场物理隔离与地面警示标识，必要时增设光幕或门禁联锁。",
  "预防措施（Prevention）：对相关班组开展区域管理与行为规范再培训，并留存培训记录。",
  "有效性确认（Effectiveness Check）：整改后 30 天内复查同一机位的告警频次，由 QA 出具关闭结论。",
]

export async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前环境不支持 Web Crypto（需要 HTTPS 或 localhost）")
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function formatOffset(offsetSec: number) {
  return `${offsetSec >= 0 ? "T+" : "T-"}${Math.abs(offsetSec)}s`
}

function buildIncidentPayload({ dossier, keyframes, actions, feedback, falsePositiveLabel }: GmpEvidenceInput) {
  return {
    dossierId: dossier.dossierId,
    incidentId: dossier.incidentId,
    channel: { id: dossier.channelId, name: dossier.channelName },
    title: dossier.title,
    occurredAt: dossier.timestamp,
    severity: dossier.severity,
    status: dossier.status,
    clip: { duration: dossier.clipDuration, size: dossier.clipSize },
    violatedClauses: dossier.violatedClauses,
    overview: SUMMARY_OVERVIEW,
    causalChain: SUMMARY_CAUSAL_CHAIN,
    keyframes: keyframes.map((kf) => ({
      id: kf.id,
      offset: formatOffset(kf.offsetSec),
      label: kf.label,
      breach: kf.breach,
      confidence: kf.confidence,
    })),
    actionLog: actions.map((action) => ({
      id: action.id,
      operator: action.operator,
      actionType: action.actionType,
      notes: action.notes,
      time: action.timestamp,
    })),
    falsePositiveFeedback: feedback
      ? { reason: falsePositiveLabel ?? feedback.reason, explanation: feedback.explanation, submittedAt: feedback.submittedAt }
      : null,
  }
}

function buildAuditReport(input: GmpEvidenceInput, sha256: string, generatedAt: string) {
  const { dossier, keyframes, actions } = input
  const line = "=".repeat(64)
  const rows: string[] = [
    line,
    "GMP 偏差审计报告（GMP Deviation Audit Report）",
    line,
    `案卷编号：${dossier.dossierId}`,
    `关联事件：${dossier.incidentId}`,
    `监控机位：${dossier.channelId} ${dossier.channelName}`,
    `事件时间：${dossier.timestamp}`,
    `案卷状态：${dossier.status}`,
    `偏差分级：${DEVIATION_CLASS[dossier.severity]}`,
    `报告生成：${generatedAt}`,
    `SHA-256：${sha256}`,
    "",
    "一、事件概述",
    SUMMARY_OVERVIEW,
    "",
    "二、因果推理链",
    ...SUMMARY_CAUSAL_CHAIN.map((step, index) => `${index + 1}. ${step}`),
    "",
    "三、违反的规程条款",
    ...dossier.violatedClauses.map((clause, index) => `${index + 1}. ${clause}`),
    "",
    "四、关键帧时间线",
    ...keyframes.map(
      (kf) =>
        `${kf.id}  ${formatOffset(kf.offsetSec).padEnd(5)}  ${kf.breach ? "[违规]" : "[正常]"}  ${kf.label}  (置信度 ${kf.confidence.toFixed(2)})`
    ),
    "",
    "五、处置记录",
    ...[...actions]
      .reverse()
      .map((action) => `${action.timestamp}  ${action.operator}  ${action.actionType}：${action.notes}`),
    "",
    "六、纠正与预防措施（CAPA）",
    ...CAPA_ACTIONS.map((item, index) => `${index + 1}. ${item}`),
    "",
    "七、说明",
    "本报告由 Vigil-AI 依据视频研判结果自动生成，偏差分级与条款归属须由质量保证（QA）人员复核确认后方可作为正式偏差记录。",
    "校验方式：对 manifest.json 中 incident 字段的规范化 JSON 文本计算 SHA-256，应与 sha256_checksum.txt 一致。",
    line,
  ]
  return rows.join("\n")
}

export async function buildGmpEvidenceArchive(
  input: GmpEvidenceInput,
  onProgress?: (percent: number) => void
): Promise<GmpEvidenceArchive> {
  onProgress?.(10)
  const generatedAt = new Date().toISOString()
  const incident = buildIncidentPayload(input)
  const incidentText = JSON.stringify(incident)

  const sha256 = await sha256Hex(incidentText)
  onProgress?.(40)

  const manifest = {
    format: "vigil-gmp-evidence/1",
    generatedAt,
    dossierId: input.dossier.dossierId,
    incidentId: input.dossier.incidentId,
    channel: incident.channel,
    occurredAt: input.dossier.timestamp,
    sha256,
    hashAlgorithm: "SHA-256",
    hashScope: "JSON.stringify(incident)",
    gmpDeviationClassification: DEVIATION_CLASS[input.dossier.severity],
    files: ["manifest.json", "GMP_DEVIATION_AUDIT_REPORT.txt", "sha256_checksum.txt"],
    incident,
  }

  const files: Array<[string, string]> = [
    ["manifest.json", JSON.stringify(manifest, null, 2)],
    ["GMP_DEVIATION_AUDIT_REPORT.txt", buildAuditReport(input, sha256, generatedAt)],
    ["sha256_checksum.txt", `${sha256}  incident-payload\n`],
  ]
  onProgress?.(60)

  const { default: JSZip } = await import("jszip")
  const zip = new JSZip()
  for (const [name, content] of files) zip.file(name, content)
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" }, (meta) =>
    onProgress?.(60 + Math.round(meta.percent * 0.4))
  )
  onProgress?.(100)

  return {
    fileName: `GMP_EVIDENCE_${input.dossier.dossierId}.zip`,
    blob,
    sha256,
    entries: files.map(([name]) => name),
  }
}

export function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
