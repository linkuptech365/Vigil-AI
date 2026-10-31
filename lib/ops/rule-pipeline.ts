import type { HandPoseFilter, RulePipelineConfig } from "./types"

export const WILDCARD_SUBJECT = "*"
export const DEFAULT_TRACK_COOLDOWN_SECONDS = 90
export const MAX_TRACK_COOLDOWN_SECONDS = 3600

const MAX_CLASSES = 8
const MAX_CLASS_LENGTH = 40
const MAX_ROI_IDS = 20
const MAX_INTENT_LENGTH = 500
const MAX_EXCLUSIONS = 20
const MAX_EXCLUSION_LENGTH = 120

export interface SubjectPreset {
  key: string
  label: string
  classes: string[]
}

/** 触发主体的快速选项；也可以在界面上追加任意自定义类别。 */
export const SUBJECT_PRESETS: SubjectPreset[] = [
  { key: "person", label: "人员", classes: ["person"] },
  { key: "hand", label: "手部", classes: ["hand"] },
  { key: "vehicle", label: "车辆", classes: ["forklift", "vehicle"] },
  { key: "generic", label: "通用", classes: [WILDCARD_SUBJECT] },
]

export const COOLDOWN_CHOICES = [30, 60, 90, 120, 300, 600] as const

export function defaultPipeline(rule: { id: string; name: string }): RulePipelineConfig {
  return {
    id: rule.id,
    name: rule.name,
    perception_gate: { subject_classes: ["person"], require_roi: false, bound_roi_ids: [], hand_pose_filter: "NONE" },
    interaction_gate: { require_context_object: false, context_classes: [], max_interaction_distance: undefined },
    vlm_arbitration: { system_intent_prompt: "", negative_exclusions: [] },
    throttling: { track_cooldown_seconds: DEFAULT_TRACK_COOLDOWN_SECONDS, enable_shadow_review: false },
  }
}

export function subjectLabel(cls: string) {
  if (cls === WILDCARD_SUBJECT) return "通用（任意主体）"
  const preset = SUBJECT_PRESETS.find((item) => item.classes.includes(cls))
  return preset && preset.classes.length === 1 ? preset.label : cls
}

type ParseResult = { ok: true; value: RulePipelineConfig } | { ok: false; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function cleanList(value: unknown, field: string, max: number, maxLength: number): string[] | string {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return `${field} 必须是字符串数组`
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== "string") return `${field} 必须是字符串数组`
    const text = item.replace(/\s+/g, " ").trim()
    if (!text) continue
    if (text.length > maxLength) return `${field} 的单项不能超过 ${maxLength} 个字符`
    if (!out.some((existing) => existing.toLowerCase() === text.toLowerCase())) out.push(text)
  }
  if (out.length > max) return `${field} 最多 ${max} 项`
  return out
}

/** 校验并规整管道配置；id / name 由调用方按所属规则覆盖。 */
export function parsePipeline(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, message: "pipeline 必须是对象" }
  const { perception_gate: gate, interaction_gate: interaction, vlm_arbitration: vlm, throttling } = value
  if (!isRecord(gate)) return { ok: false, message: "pipeline.perception_gate 缺失" }
  if (!isRecord(interaction)) return { ok: false, message: "pipeline.interaction_gate 缺失" }
  if (!isRecord(vlm)) return { ok: false, message: "pipeline.vlm_arbitration 缺失" }
  if (!isRecord(throttling)) return { ok: false, message: "pipeline.throttling 缺失" }

  const subjects = cleanList(gate.subject_classes, "perception_gate.subject_classes", MAX_CLASSES, MAX_CLASS_LENGTH)
  if (typeof subjects === "string") return { ok: false, message: subjects }
  if (subjects.length === 0) return { ok: false, message: "perception_gate.subject_classes 至少需要一个触发主体" }
  if (typeof gate.require_roi !== "boolean") return { ok: false, message: "perception_gate.require_roi 必须是布尔值" }
  const roiIds = cleanList(gate.bound_roi_ids, "perception_gate.bound_roi_ids", MAX_ROI_IDS, 64)
  if (typeof roiIds === "string") return { ok: false, message: roiIds }
  const pose = gate.hand_pose_filter ?? "NONE"
  if (pose !== "HAND_ELEVATED" && pose !== "NONE") {
    return { ok: false, message: "perception_gate.hand_pose_filter 必须是 HAND_ELEVATED 或 NONE" }
  }

  if (typeof interaction.require_context_object !== "boolean") {
    return { ok: false, message: "interaction_gate.require_context_object 必须是布尔值" }
  }
  const contexts = cleanList(interaction.context_classes, "interaction_gate.context_classes", MAX_CLASSES, MAX_CLASS_LENGTH)
  if (typeof contexts === "string") return { ok: false, message: contexts }
  if (interaction.require_context_object && contexts.length === 0) {
    return { ok: false, message: "要求检出伴生物体时，context_classes 至少需要一个类别" }
  }
  let distance: number | undefined
  if (interaction.max_interaction_distance !== undefined && interaction.max_interaction_distance !== null) {
    const raw = interaction.max_interaction_distance
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1000) {
      return { ok: false, message: "interaction_gate.max_interaction_distance 必须是 0~1000 之间的数字" }
    }
    distance = Math.round(raw)
  }

  const intent = typeof vlm.system_intent_prompt === "string" ? vlm.system_intent_prompt.trim() : ""
  if (intent.length > MAX_INTENT_LENGTH) {
    return { ok: false, message: `vlm_arbitration.system_intent_prompt 不能超过 ${MAX_INTENT_LENGTH} 个字符` }
  }
  const exclusions = cleanList(vlm.negative_exclusions, "vlm_arbitration.negative_exclusions", MAX_EXCLUSIONS, MAX_EXCLUSION_LENGTH)
  if (typeof exclusions === "string") return { ok: false, message: exclusions }

  const cooldown = throttling.track_cooldown_seconds
  if (typeof cooldown !== "number" || !Number.isFinite(cooldown) || cooldown < 0 || cooldown > MAX_TRACK_COOLDOWN_SECONDS) {
    return { ok: false, message: `throttling.track_cooldown_seconds 必须是 0~${MAX_TRACK_COOLDOWN_SECONDS} 之间的数字` }
  }
  if (typeof throttling.enable_shadow_review !== "boolean") {
    return { ok: false, message: "throttling.enable_shadow_review 必须是布尔值" }
  }

  return {
    ok: true,
    value: {
      id: typeof value.id === "string" ? value.id : "",
      name: typeof value.name === "string" ? value.name : "",
      perception_gate: {
        subject_classes: subjects,
        require_roi: gate.require_roi,
        bound_roi_ids: roiIds,
        hand_pose_filter: pose as HandPoseFilter,
      },
      interaction_gate: {
        require_context_object: interaction.require_context_object,
        context_classes: contexts,
        max_interaction_distance: distance,
      },
      vlm_arbitration: { system_intent_prompt: intent, negative_exclusions: exclusions },
      throttling: {
        track_cooldown_seconds: Math.round(cooldown),
        enable_shadow_review: throttling.enable_shadow_review,
      },
    },
  }
}

/** 管道对 VLM 的补充：核心违规意图拼进判定依据，排除项并入规则排除清单。 */
export function pipelineVlmContext(pipeline: RulePipelineConfig | undefined) {
  if (!pipeline) return { intent: "", exclusions: [] as string[] }
  return {
    intent: pipeline.vlm_arbitration.system_intent_prompt.trim(),
    exclusions: pipeline.vlm_arbitration.negative_exclusions.filter(Boolean),
  }
}
