import { SOURCE_ALL } from "./rule-binding"
import type { InspectionRule } from "./rules-types"

export const GMP_PRESET_LABEL = "加载 GMP 洁净室标准预设"

const COMMON = {
  type: "PROMPT_SEMANTIC",
  boundChannels: [SOURCE_ALL],
  cooldownSeconds: 60,
  schedule: "24x7",
  enabled: true,
  sensitivity: 0.85,
  actions: { webhook: true, dispatch: true, siren: false },
} as const satisfies Partial<InspectionRule>

/**
 * 制药 / 生物安全 GMP 洁净室核心合规规则。
 * 系统风险等级只有 INFO / WARNING / CRITICAL 三档，需求里的 HIGH 对应 WARNING。
 */
export const GMP_CLEANROOM_RULES: InspectionRule[] = [
  {
    ...COMMON,
    id: "RULE-GMP-PPE",
    name: "洁净室防护穿戴合规 (PPE Gowning)",
    severity: "CRITICAL",
    boundChannels: [...COMMON.boundChannels],
    actions: { ...COMMON.actions, siren: true },
    prompt: [
      "严格检查作业人员穿戴合规性。作业人员必须规范穿着白色或防静电连体洁净服、洁净工作帽、无菌口罩、防静电鞋套或洁净专用鞋。",
      "违规判定项：",
      "1. 工作帽未完全包覆头发，出现发丝、刘海或胡须露在帽子外；",
      "2. 未佩戴口罩，或口罩脱落/下拉至下巴未遮盖口鼻；",
      "3. 未穿专用洁净服露出日常便服，或未穿专用洁净鞋/鞋套；",
      "4. 手部未戴手套或手套破损卷边露出手腕皮肤。",
      "若发现上述任一现象，立即判定违规并触发告警。",
    ].join("\n"),
  },
  {
    ...COMMON,
    id: "RULE-GMP-POSTURE",
    name: "洁净室行为规范与靠墙检测 (Posture & Behavior)",
    severity: "WARNING",
    boundChannels: [...COMMON.boundChannels],
    actions: { ...COMMON.actions },
    prompt: [
      "监控洁净室内作业人员的行为姿态。洁净区内作业人员严禁倚靠墙面或剧烈运动（以防止颗粒脱落与静电积聚）。",
      "违规判定项：",
      "1. 人员身体、后背、肩膀、臀部贴靠在洁净板墙壁或窗台；",
      "2. 人员倚靠在生产设备外壳或配电柜上站立；",
      "3. 双手插兜站立、在走廊内奔跑或快速挥舞手臂走动；",
      "4. 坐卧在未经允许的非工作座椅/地面/物料箱上。",
      "若发现上述倚靠或不当姿态，立即判定违规并触发告警。",
    ].join("\n"),
  },
  {
    ...COMMON,
    id: "RULE-GMP-ASEPTIC",
    name: "试剂容器摆放与无菌操作 (Aseptic & Material Handling)",
    severity: "WARNING",
    boundChannels: [...COMMON.boundChannels],
    actions: { ...COMMON.actions },
    prompt: [
      "监控操作台面、传递窗及物料区的试剂容器摆放与人员操作防污染规范。",
      "违规判定项：",
      "1. 试剂瓶、培养皿、烧杯等直接放置在地面或未灭菌的非指定台面；",
      "2. 操作人员的手部、手臂从敞口无菌容器上方直接横跨扫过（阻断洁净单向层流）；",
      "3. 洁净区内出现外部瓦楞纸箱、茶水杯、饮料瓶、私人手机等严禁带入的外来污染物品。",
      "若发现违规摆放、气流阻断或违禁物品，立即判定违规并触发告警。",
    ].join("\n"),
  },
]

export const GMP_CLEANROOM_RULE_IDS = GMP_CLEANROOM_RULES.map((rule) => rule.id)
