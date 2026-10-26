import type { VlmPromptRule } from "../vlm-api-types"
import type { NormalizedInput } from "./vlm-shared"

/** 规则库里没有任何业务内容时，指令里的占位符。 */
const NO_RULE_ID = "NONE"

function formatRule(rule: VlmPromptRule, index: number) {
  const exclusions = rule.exclusions?.filter(Boolean) ?? []
  return [
    `[规则序号 ${index + 1}]`,
    `- 规则编号: ${rule.id}`,
    `- 规则名称: ${rule.name}`,
    `- 语义判定依据: ${rule.description}`,
    `- 置信度阈值要求: ≥ ${rule.sensitivity}`,
    `- 告警等级: ${rule.severity}`,
    exclusions.length
      ? `- 明确排除场景（命中任一项即 exclusion_matched=true，严禁报警）: ${exclusions.map((item, i) => `(${i + 1}) ${item}`).join("；")}`
      : "- 明确排除场景: （未配置；仍须按原则 7 自行排查外观相似的非目标动作）",
  ].join("\n")
}

export function buildRulesBlock(rules: VlmPromptRule[]) {
  return rules.map(formatRule).join("\n\n")
}

/**
 * 实时通道专用：判定成立后，要求模型把画面里更高辨识度的目标/锚点反哺给一级初筛（YOLO-World）。
 * 未触发或没有把握时一律省略该字段，避免污染词表。
 */
function buildTier1FeedbackBlock(existing: string[]) {
  const known = existing.length ? existing.join(", ") : "（无）"
  return {
    rules: `
6. 【反哺一级初筛】仅在 triggered=true 且你对画面中的目标有把握时，额外输出 tier1_feedback，帮助一级目标检测器（YOLO-World，只认英文名词短语）以后更容易发现同类场景；未触发或没有把握时必须省略该字段：
   - recommended_tags：补充 1~3 个画面中实际可见、辨识度高的英文名词短语（如 "white plastic pet dispenser"），必须是具体可见的物体，不得是动作或抽象概念；不要与一级已使用词重复。一级当前已使用词：${known}。role 取 "subject_target"（行为主体，如猫、人）或 "context_object"（环境/道具，如喂食器、食盆）；confidence_threshold 为 0.2~0.6 的建议置信度门槛，小物体或易混淆物体取较低值。
   - spatial_hotspot：若该行为总在画面某个固定位置发生（如进食点），给出该点的归一化坐标 center=[x, y]（0~1000）与影响半径 radius（0~1000）及中文 description；位置不固定则省略。
   - trigger_policy：当主要环境物体因遮挡、过小或检测不稳而难以和主体同框时，取 "ANCHOR_PROXIMITY"（主体进入锚点范围即触发二级研判）；否则取 "DUAL_INTERACTION"。只有给出 spatial_hotspot 时才可取 "ANCHOR_PROXIMITY"。`,
    schema: `,
  "tier1_feedback": {
    "recommended_tags": [{ "tag": "英文名词短语", "zh_name": "中文名称", "role": "subject_target" 或 "context_object", "confidence_threshold": 0.3 }],
    "spatial_hotspot": { "center": [x, y], "radius": 150, "description": "中文描述" },
    "trigger_policy": "DUAL_INTERACTION" 或 "ANCHOR_PROXIMITY"
  }（仅 triggered=true 且有把握时输出，否则整个字段省略）`,
  }
}

/** 仲裁指令完全由规则库动态拼装，不包含任何内置的具体业务词汇。 */
export function buildSystemInstruction(rules: VlmPromptRule[], tier1Existing?: string[]) {
  const feedbackBlock = tier1Existing ? buildTier1FeedbackBlock(tier1Existing) : { rules: "", schema: "" }
  return `你是一个多模态视频研判专家。
请审查所提供的连续视频序列采样帧，根据下面给出的【生效检测规则库】进行逐项客观研判。

【生效检测规则库】
${buildRulesBlock(rules)}

【研判原则】
1. 仅根据视频中实际发生的客观视觉事实与动作进行研判，严禁凭空揣测。
2. 逐一比对上述规则中的「语义判定依据」。若画面中明确出现了符合某条规则描述的现象、动作、违规或物体，且置信度达到或超过该规则设定的「置信度阈值要求」，判定为违规并返回该规则编号。
3. 若画面一切正常，未触发上述任一规则的判定依据，或置信度低于阈值，则判定为安全 (SAFE)。
4. 同时命中多条规则时，只返回告警等级最高的一条。
5. 判定违规时必须给出证据锚点：指出违规最清晰的那一张采样帧（frame_index）及其时间点（timestamp_offset）。违规跨越多帧时，选最能体现违规的一帧。两者必须来自用户消息里的采样帧清单，不得编造。
7. 【目标介质与动作解耦】严禁仅凭主体姿态做粗粒度断言（例如仅因动物低头就判定为进食、仅因手部靠近就判定为违规触碰）。必须分别独立回答四个要素并写入 verdict_detail：
   - primary_action：画面中实际发生的具体动作（英文蛇形命名，如 eating_kibble / drinking_water / gowning_touch / idle）；
   - interaction_target：主体正在交互的介质或物体（category，如 dry_food_tray / water_dispenser / cleanroom_zone_a）及其辨识置信度；
   - exclusion_matched：逐条比对规则的「明确排除场景」，并主动排查外观姿态高度相似的非目标动作（如水面反光、舔舐水面、正常操作）；命中任一项必须为 true，并在 exclusion_reason 中说明依据；
   - confidence：对整体判定的置信度。
8. 【防御性判定】只有 primary_action 完全符合目标规则的语义、interaction_target 与规则要求的介质一致，且 exclusion_matched 为 false 时，才允许 triggered=true 且 verdict_detail.is_alarm=true；否则一律判定为安全。画面存在遮挡、动作模糊或置信度落在 0.5~0.75 时，将 verdict_detail.shadow_review 置为 true（记为存疑审计，不产生正式告警）。${feedbackBlock.rules}

输出必须严格遵循以下 JSON 结构，只输出一个 \`\`\`json 代码块，不要包含任何多余解释：
{
  "triggered": true 或 false,
  "rule_id": "触发的规则编号（未触发填 ${NO_RULE_ID}）",
  "rule_name": "触发的规则名称（未触发填 无）",
  "severity": "CRITICAL" | "WARNING" | "INFO" | "SAFE",
  "confidence": 0.88,
  "timestamp_offset": "违规发生的精确时间戳，格式 mm:ss.mmm，应对应帧清单中该帧的时间点（未触发填 00:00.000）",
  "frame_index": 触发违规的采样帧编号，即帧清单里「帧 #N」的 N，整数（未触发或无法确定填 null）,
  "bbox": [ymin, xmin, ymax, xmax] 或 null,
  "reasoning": "客观详实的研判论据，阐述画面中何时、何处、观察到什么具体情况导致匹配该规则",
  "advice": "针对该违规项的标准处置指引",
  "verdict_detail": {
    "is_alarm": true 或 false,
    "primary_action": "eating_kibble",
    "interaction_target": { "category": "dry_food_tray", "confidence": 0.9 },
    "exclusion_matched": false,
    "exclusion_reason": "命中排除场景时填写依据，否则省略",
    "confidence": 0.88,
    "shadow_review": 存疑时为 true，否则省略
  }${feedbackBlock.schema}
}
其中 bbox 的四个数值为归一化到 0~1000 的整数坐标，无法定位时填 null；severity 取值必须与命中规则的告警等级一致。`
}

export function buildUserPrompt(input: NormalizedInput, imageCount: number) {
  const frames = input.keyframes.length
    ? input.keyframes
        .map((f) => {
          const motion = typeof f.motionScore === "number" ? ` | motionScore=${f.motionScore.toFixed(2)}` : ""
          return `- 帧 #${f.index} | ${f.timecode} | t=${f.timestampSec}s${motion}`
        })
        .join("\n")
    : "（未提供关键帧）"
  const pixels =
    imageCount > 0
      ? `已随消息附带 ${imageCount} 帧真实画面（取自上表中的部分时刻），每张图前都有对应的采样时间点标签。`
      : "本次请求未附带像素帧，仅提供时序元数据；请据此谨慎推断并相应降低 confidence。"

  return [
    `分析对象: ${input.videoPath ?? "未提供"}`,
    `时序关键帧（共 ${input.keyframes.length} 帧，按时间升序）:`,
    frames,
    pixels,
    "请按系统指令的 JSON 结构输出。",
  ].join("\n")
}
