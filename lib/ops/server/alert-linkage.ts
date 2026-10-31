import { appendCaseAction, getAlert, updateAlert } from "@/lib/storage/streams-store"
import { LINKAGE_CHANNELS, type LinkageChannel, type LinkageResult, type StreamAlert } from "@/lib/vigil/streams"

const LINKAGE_TIMEOUT_MS = 8_000

function channelUrl(env: string) {
  const value = process.env[env]?.trim()
  return value && /^https?:\/\//i.test(value) ? value : null
}

function messageText(alert: StreamAlert) {
  return `【Vigil-AI ${alert.severity}】${alert.streamName}（${alert.zone}）触发「${alert.ruleName}」：${alert.summary}（置信度 ${alert.confidence}%，案卷 ${alert.case?.caseId ?? "-"}）`
}

function payloadFor(channel: LinkageChannel, alert: StreamAlert) {
  const text = messageText(alert)
  if (channel === "IM_BOT") {
    // 同时携带飞书与钉钉/企微的文本消息结构，同一个地址即可兼容
    return { msg_type: "text", content: { text }, msgtype: "text", text: { content: text } }
  }
  return {
    event: "vigil.alert",
    text,
    alertId: alert.id,
    caseId: alert.case?.caseId,
    severity: alert.severity,
    stream: { id: alert.streamId, name: alert.streamName, zone: alert.zone },
    rule: { id: alert.ruleId, name: alert.ruleName },
    confidence: alert.confidence,
    summary: alert.summary,
    triggeredAt: alert.triggeredAt,
    evidence: { recordHash: alert.seal?.recordHash, frames: alert.seal?.files.length ?? 0 },
  }
}

async function fireChannel(channel: LinkageChannel, name: string, url: string, alert: StreamAlert): Promise<LinkageResult> {
  const firedAt = new Date().toISOString()
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadFor(channel, alert)),
      signal: AbortSignal.timeout(LINKAGE_TIMEOUT_MS),
    })
    return response.ok
      ? { channel, name, status: "SUCCESS", firedAt, detail: `HTTP ${response.status}` }
      : { channel, name, status: "FAILED", firedAt, detail: `对端返回 HTTP ${response.status}` }
  } catch (error) {
    return { channel, name, status: "FAILED", firedAt, detail: error instanceof Error ? error.message : "请求失败" }
  }
}

/**
 * 触发联动渠道并把结果写回案卷。force=true 为人工“全渠道广播”：忽略“仅严重告警触发”的限制。
 * 未配置对端地址的渠道如实记为 NOT_CONFIGURED，不会伪装成已送达。
 */
export async function fireLinkage(alertId: string, options: { force: boolean; operator: string }) {
  const alert = getAlert(alertId)
  if (!alert?.case) return null

  const results: LinkageResult[] = await Promise.all(
    LINKAGE_CHANNELS.map(async ({ channel, name, env, criticalOnly }): Promise<LinkageResult> => {
      if (criticalOnly && !options.force && alert.severity !== "CRITICAL") {
        return { channel, name, status: "SKIPPED", detail: "仅严重（CRITICAL）告警自动触发" }
      }
      const url = channelUrl(env)
      if (!url) return { channel, name, status: "NOT_CONFIGURED", detail: `未配置环境变量 ${env}` }
      return fireChannel(channel, name, url, alert)
    })
  )

  const delivered = results.filter((r) => r.status === "SUCCESS").map((r) => r.name)
  const failed = results.filter((r) => r.status === "FAILED").map((r) => r.name)
  const unconfigured = results.filter((r) => r.status === "NOT_CONFIGURED").length

  updateAlert(alertId, (current) => {
    if (!current.case) return null
    const merged = LINKAGE_CHANNELS.map(({ channel }) => {
      const next = results.find((r) => r.channel === channel)
      const previous = current.case?.linkage.find((r) => r.channel === channel)
      // 自动联动跳过的渠道，不覆盖此前已成功的记录
      return next && !(next.status === "SKIPPED" && previous) ? next : previous
    }).filter((r): r is LinkageResult => Boolean(r))
    return { ...current, case: { ...current.case, linkage: merged } }
  })

  const parts = [
    delivered.length ? `已送达：${delivered.join("、")}` : "",
    failed.length ? `失败：${failed.join("、")}` : "",
    unconfigured ? `${unconfigured} 个渠道未配置对端地址` : "",
  ].filter(Boolean)
  appendCaseAction(alertId, {
    operator: options.operator,
    actionType: options.force ? "全渠道联合广播" : "自动联动",
    notes: parts.join("；") || "没有可触发的联动渠道",
  })
  return results
}

export function fireAutoLinkage(alertId: string) {
  return fireLinkage(alertId, { force: false, operator: "Vigil-AI 系统" })
}
