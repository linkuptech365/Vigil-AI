import type { VlmPromptRule } from "../vlm-api-types"
import type { NormalizedInput } from "./vlm-shared"

/** 规则库里没有任何业务内容时，指令里的占位符。 */
const NO_RULE_ID = "NONE"

function formatRule(rule: VlmPromptRule, index: number) {
  return [
    `[规则序号 ${index + 1}]`,
    `- 规则编号: ${rule.id}`,
    `- 规则名称: ${rule.name}`,
    `- 语义判定依据: ${rule.description}`,
    `- 置信度阈值要求: ≥ ${rule.sensitivity}`,
    `- 告警等级: ${rule.severity}`,
  ].join("\n")
}

export function buildRulesBlock(rules: VlmPromptRule[]) {
  return rules.map(formatRule).join("\n\n")
}

/** 仲裁指令完全由规则库动态拼装，不包含任何内置的具体业务词汇。 */
export function buildSystemInstruction(rules: VlmPromptRule[]) {
  return `你是一个多模态视频研判专家。
请审查所提供的连续视频序列采样帧，根据下面给出的【生效检测规则库】进行逐项客观研判。

【生效检测规则库】
${buildRulesBlock(rules)}

【研判原则】
1. 仅根据视频中实际发生的客观视觉事实与动作进行研判，严禁凭空揣测。
2. 逐一比对上述规则中的「语义判定依据」。若画面中明确出现了符合某条规则描述的现象、动作、违规或物体，且置信度达到或超过该规则设定的「置信度阈值要求」，判定为违规并返回该规则编号。
3. 若画面一切正常，未触发上述任一规则的判定依据，或置信度低于阈值，则判定为安全 (SAFE)。
4. 同时命中多条规则时，只返回告警等级最高的一条。

输出必须严格遵循以下 JSON 结构，只输出一个 \`\`\`json 代码块，不要包含任何多余解释：
{
  "triggered": true 或 false,
  "rule_id": "触发的规则编号（未触发填 ${NO_RULE_ID}）",
  "rule_name": "触发的规则名称（未触发填 无）",
  "severity": "CRITICAL" | "WARNING" | "INFO" | "SAFE",
  "confidence": 0.88,
  "timestamp_offset": "违规发生的精确时间戳，格式 mm:ss.mmm（未触发填 00:00.000）",
  "bbox": [ymin, xmin, ymax, xmax] 或 null,
  "reasoning": "客观详实的研判论据，阐述画面中何时、何处、观察到什么具体情况导致匹配该规则",
  "advice": "针对该违规项的标准处置指引"
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
