import { RULES } from "@/lib/vigil/rules"
import type { VlmFinalResult, VlmKeyframeInput, VlmStreamChunk } from "../vlm-api-types"
import { classifyScenario, type ScenarioKind } from "../vlm-scenario-match"
import type { VlmSeverity } from "../vlm-types"
import {
  abortableSleep,
  costUsd,
  estimateTokens,
  hashString,
  modelProfile,
  type EngineContext,
  type NormalizedInput,
} from "./vlm-shared"

interface Step {
  from: number
  to: number
  text: string
}

interface FallbackScenario {
  ruleTriggered: string
  severity: VlmSeverity
  confidence: number
  summary: string
  intent: string
  steps: Step[]
  conclusion: string
  evidencePos: number[]
  clauses: string[]
  advice: string
}

const SCENARIO_DEFS: Record<ScenarioKind, FallbackScenario> = {
  violence: {
    ruleTriggered: RULES.violence.ruleName,
    severity: "CRITICAL",
    confidence: 0.946,
    summary: "两名人员在通道内发生争执并升级为肢体冲突，其中一方被击倒后遭持续压制。",
    intent:
      "非日常友好交流。序列中出现握拳挥击、目标失去平衡倒地、随后持续肢体压制并伴随反抗，周边无人劝阻，判定为高风险暴力斗殴事件。",
    steps: [
      { from: 0, to: 2, text: "两名人员相向行走，肢体语言平稳，双手未持工具" },
      { from: 2, to: 3, text: "双方距离缩短至 0.5m 以内，出现手臂张开、上身前倾的争执特征" },
      { from: 3, to: 4, text: "一方握拳挥击击中另一方，被击者重心后仰并倒地" },
      { from: 5, to: 7, text: "持续肢体压制并伴随明显反抗，周边无第三方介入" },
    ],
    conclusion: "行为序列符合「争执 → 挥击 → 倒地 → 压制」的暴力冲突因果链，可排除嬉闹、协作搬运与医疗施救。",
    evidencePos: [3, 4, 5, 6],
    clauses: ["厂区人身安全红线条例 第 3.2 款"],
    advice: "声光报警并推送至安保值班长，锁定前后 60 秒原始码流取证，联动最近岗位画面。",
  },
  intrusion: {
    ruleTriggered: RULES.intrusion.ruleName,
    severity: "CRITICAL",
    confidence: 0.931,
    summary: "人员越过警戒线进入设备回转半径，无防护且无监护人员同行。",
    intent:
      "非授权擅入。目标未佩戴安全帽，径直进入运行设备的回转半径并持续停留，轨迹与正常巡检路径不符，判定为严重违反禁区管理规定的入侵行为。",
    steps: [
      { from: 0, to: 1, text: "目标沿通道行走，距警戒线约 2.5m，朝向设备作业区" },
      { from: 2, to: 3, text: "目标越过黄色警戒线进入电子围栏，未停顿观察" },
      { from: 3, to: 5, text: "目标在设备回转半径内停留，头部无安全帽，手部无作业凭证" },
      { from: 5, to: 7, text: "目标持续停留，无监护人员同行，周边设备仍在运行" },
    ],
    conclusion: "满足「无防护 + 无监护 + 运行设备禁区」三项叠加，排除授权巡检与停机维护。",
    evidencePos: [2, 3, 4],
    clauses: ["设备作业区安全距离管理规定 第 2.4 款"],
    advice: "声光报警并语音喊话驱离，通知车间主任与安全员，视情联动设备减速预案。",
  },
  crowd: {
    ruleTriggered: "通道人员异常聚集识别",
    severity: "WARNING",
    confidence: 0.874,
    summary: "多名人员在叉车主通道中央围拢停留，阻塞物流动线。",
    intent:
      "非作业性聚集。人员围拢超过 20 秒且无搬运或盘点动作，正对叉车来向，阻塞通道并存在碰撞风险，判定为需干预的聚集隐患。",
    steps: [
      { from: 0, to: 1, text: "通道内人员陆续靠近，首位人员停步，其余向其聚拢" },
      { from: 2, to: 3, text: "多人在通道中央围成半圆交谈，手中无货物或搬运工具" },
      { from: 4, to: 5, text: "叉车自另一端驶近，人群未让行，叉车被迫减速" },
      { from: 6, to: 7, text: "聚集持续，物流动线被阻塞，存在叉车与行人碰撞风险" },
    ],
    conclusion: "非作业性聚集叠加叉车来向，属于需现场干预的一般预警。",
    evidencePos: [3, 4, 5],
    clauses: ["仓储物流通道通行规范 第 5.1 款"],
    advice: "语音广播提示疏散通道，通知仓储班组长现场确认，叉车端同步限速。",
  },
  ppe: {
    ruleTriggered: RULES.ppe.ruleName,
    severity: "WARNING",
    confidence: 0.902,
    summary: "人员在作业区持续活动，未佩戴安全帽且未穿反光背心。",
    intent:
      "PPE 防护缺失。目标在设备作业区停留数秒，头部无安全帽特征、躯干无反光条带，同画面合规人员可作对照，排除成像质量导致的误判。",
    steps: [
      { from: 0, to: 2, text: "人员进入机加工作业区，头部区域未检出安全帽特征" },
      { from: 3, to: 5, text: "躯干区域无反光条带，与同画面合规人员形成对照" },
      { from: 6, to: 7, text: "违规状态持续，未发生自行纠正" },
    ],
    conclusion: "满足「作业区 + 持续停留 + PPE 缺失」，成像质量足以判别，判定为 PPE 违规。",
    evidencePos: [1, 3, 5],
    clauses: ["作业区个人防护装备管理规定 第 4.1 款"],
    advice: "现场广播提醒佩戴防护装备，班组长到场确认，记录工号纳入当班安全考核。",
  },
  fire: {
    ruleTriggered: RULES.fire.ruleName,
    severity: "CRITICAL",
    confidence: 0.918,
    summary: "画面上部出现持续扩散的灰白色烟雾，后期伴随橙色高亮点。",
    intent:
      "初期阴燃向明火发展。烟雾面积随时间单调扩大、边缘呈上升扩散形态，区别于水汽或灯光反射，后期局部出现橙色高亮点，判定为烟火异常。",
    steps: [
      { from: 0, to: 2, text: "画面上部出现低对比度灰白色团状烟雾" },
      { from: 3, to: 5, text: "烟雾面积单调扩大，边缘呈上升扩散形态" },
      { from: 6, to: 7, text: "局部出现橙色高亮点，符合阴燃向明火发展的视觉模式" },
    ],
    conclusion: "烟雾持续扩散叠加橙色高亮点，判定为初期阴燃或明火风险。",
    evidencePos: [4, 5, 6],
    clauses: ["消防安全管理规定 第 6.2 款"],
    advice: "触发区域声光报警，通知消防值班前往确认，断电疏散并准备初期灭火。",
  },
  safe: {
    ruleTriggered: "无",
    severity: "SAFE",
    confidence: 0.93,
    summary: "画面内人员活动与环境状态正常，未发现违规行为。",
    intent: "人员沿既定路径通行，环境状态稳定，未观察到任何违规行为的前兆或发生。",
    steps: [
      { from: 0, to: 3, text: "人员沿既定通道正常通行，行进轨迹与巡检路径一致" },
      { from: 4, to: 7, text: "未检出与已启用规则匹配的异常行为，人员活动与环境状态均处于正常范围" },
    ],
    conclusion: "逐帧时序未出现违规因果链，判定为合规。",
    evidencePos: [],
    clauses: [],
    advice: "无需处置，保持常规巡视。",
  },
}

function frameAt(frames: VlmKeyframeInput[], pos: number) {
  if (frames.length === 0) return null
  return frames[Math.round((pos / 7) * (frames.length - 1))]
}

function frameRef(frame: VlmKeyframeInput) {
  return `帧 ${frame.index} (${frame.timecode})`
}

function stepLabel(frames: VlmKeyframeInput[], step: Step) {
  const a = frameAt(frames, step.from)
  const b = frameAt(frames, step.to)
  if (!a || !b) return `阶段 ${step.from + 1}~${step.to + 1}`
  const idx = a.index === b.index ? `帧 ${a.index}` : `帧 ${a.index}~${b.index}`
  const tc = a.timecode === b.timecode ? a.timecode : `${a.timecode}~${b.timecode}`
  return `${idx} (${tc})`
}

function findPeakMotion(frames: VlmKeyframeInput[]) {
  const scored = frames.filter((f) => typeof f.motionScore === "number" && Number.isFinite(f.motionScore))
  if (scored.length < 3) return null
  let pos = 0
  let score = -Infinity
  frames.forEach((frame, i) => {
    if (typeof frame.motionScore === "number" && frame.motionScore > score) {
      score = frame.motionScore
      pos = i
    }
  })
  return { pos, score }
}

function unique(values: number[]) {
  return Array.from(new Set(values))
}

export function planFallback(input: NormalizedInput) {
  const kind = classifyScenario(input.simulation?.scenario ?? input.ruleScenario)
  const def = SCENARIO_DEFS[kind]
  const frames = input.keyframes
  const motion = kind === "safe" ? null : findPeakMotion(frames)

  let evidenceKeyframes: number[] = []
  if (kind !== "safe" && frames.length > 0) {
    if (motion) {
      const around = [motion.pos - 1, motion.pos, motion.pos + 1].filter((p) => p >= 0 && p < frames.length)
      evidenceKeyframes = unique(around.map((p) => frames[p].index))
    } else {
      evidenceKeyframes = unique(
        def.evidencePos.flatMap((pos) => {
          const frame = frameAt(frames, pos)
          return frame ? [frame.index] : []
        })
      )
    }
  }

  const hinted = input.simulation?.confidence
  const confidence =
    typeof hinted === "number" && Number.isFinite(hinted)
      ? Math.round(Math.min(0.99, Math.max(0.5, hinted)) * 100) / 100
      : def.confidence

  const result: VlmFinalResult = {
    summary: def.summary,
    intentAnalysis: def.intent,
    severity: def.severity,
    confidence,
    ruleTriggered: def.ruleTriggered,
    evidenceKeyframes,
    violationClauses: def.clauses,
    actionAdvice: def.advice,
  }

  const observations = def.steps.map((step) => `- ${stepLabel(frames, step)}：${step.text}`)
  if (motion) {
    observations.push(
      `- 运动向量能量峰值位于${frameRef(frames[motion.pos])}，motionScore=${motion.score.toFixed(2)}，与上述行为突变点吻合`
    )
  }

  const text = [
    "### 时序观察",
    ...observations,
    "",
    "### 行为意图研判",
    def.intent,
    "",
    "### 研判结论",
    def.conclusion,
    "",
    "```json",
    JSON.stringify(result, null, 2),
    "```",
  ].join("\n")

  return { kind, result, text }
}

const CHUNK_CHARS = 8
const CHUNK_DELAY_MS = 26
const THINK_DELAY_MS = 650

export async function* fallbackStream(
  input: NormalizedInput,
  ctx: EngineContext,
  reason: string
): AsyncGenerator<VlmStreamChunk> {
  const { kind, result, text } = planFallback(input)
  const evidenceAt = text.indexOf("### 行为意图研判")
  let evidenceSent = result.evidenceKeyframes.length === 0

  if (ctx.pace) await abortableSleep(THINK_DELAY_MS, ctx.signal)

  for (let cursor = 0; cursor < text.length; cursor += CHUNK_CHARS) {
    if (ctx.signal.aborted) return
    yield { type: "token", content: text.slice(cursor, cursor + CHUNK_CHARS) }
    if (!evidenceSent && cursor + CHUNK_CHARS >= evidenceAt) {
      evidenceSent = true
      yield { type: "evidence", frames: result.evidenceKeyframes }
    }
    if (ctx.pace) await abortableSleep(CHUNK_DELAY_MS, ctx.signal)
  }
  if (!evidenceSent) yield { type: "evidence", frames: result.evidenceKeyframes }

  const frameCount = Math.max(1, input.keyframes.length)
  const promptTokens = 380 + frameCount * 255
  const outputTokens = estimateTokens(text)
  const profile = modelProfile(input.modelName)
  const seed = hashString(`${input.videoPath ?? ""}|${input.modelName}|${kind}`)
  const rttMs = Math.round((profile.latencyMs ?? 1180) * (0.92 + (seed % 17) / 100))

  yield {
    type: "done",
    result,
    metrics: {
      promptTokens,
      outputTokens,
      firstTokenMs: Math.round(rttMs * 0.34),
      rttMs,
      costUsd: costUsd(profile.ratePer1k ?? 0.00124, promptTokens, outputTokens),
      source: "fallback",
      model: input.modelName,
      fallbackReason: reason,
    },
  }
}
