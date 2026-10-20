import type { RuleId, Severity } from "./types"

export interface RuleDef {
  id: RuleId
  scenarioLabel: string
  scenarioHint: string
  ruleName: string
  severity: Severity
  brief: string
  reasoning: string
  actions: string[]
  evidence: { at: number; text: string }[]
}

export const RULES: Record<RuleId, RuleDef> = {
  violence: {
    id: "violence",
    scenarioLabel: "暴力冲突 / 打架",
    scenarioHint: "肢体推搡、殴打、聚众斗殴",
    ruleName: "暴力肢体冲突与打架识别",
    severity: "critical",
    brief: "画面中多名人员发生推搡与肢体对抗，存在持续殴打动作。",
    reasoning:
      "模型在连续采样帧中检测到 2 名以上人员距离快速缩短，随后出现手臂高频挥动与躯干前倾，其中一人在第二个关键帧出现明显后仰跌退动作，周边人员随之聚集。结合时序姿态估计，动作轨迹与“推搡 → 拳击 → 倒地”暴力冲突模式高度吻合，且持续时间超过 3 秒，排除正常打招呼、玩闹等低风险行为。",
    actions: [
      "立即通过对讲机通知最近的巡逻保安赶赴现场，并同步调取相邻点位摄像头。",
      "保留原始视频与前后 60 秒录像，禁止覆盖或删除。",
      "如现场有人员受伤，立即联系医务室或拨打 120，并通知值班经理。",
      "事件处置完毕后 24 小时内完成事件登记，并将研判结果反馈至模型标注库。",
    ],
    evidence: [
      { at: 0.18, text: "两名人员相向快速靠近，肢体姿态进入对抗状态" },
      { at: 0.42, text: "检测到连续挥臂击打动作，其中一人后仰跌退" },
      { at: 0.7, text: "周边 3 人聚集围观，冲突持续未平息" },
    ],
  },
  ppe: {
    id: "ppe",
    scenarioLabel: "未穿反光衣 / 头盔",
    scenarioHint: "作业区域 PPE 防护缺失",
    ruleName: "作业区域未佩戴安全防护装备",
    severity: "high",
    brief: "作业人员进入设备作业区，未佩戴安全帽且未穿着反光背心。",
    reasoning:
      "模型在作业区域内识别到 1 名人员持续活动超过 8 秒，头部区域未检测到安全帽特征（颜色块与硬质轮廓均缺失），躯干区域亦未发现高亮反光条带。同一画面中另一名人员的 PPE 佩戴完整，可作为对照，说明该区域防护要求明确且摄像头成像质量满足判别条件，因此判定为 PPE 违规。",
    actions: [
      "通过现场广播提醒该人员立即佩戴安全帽与反光衣，必要时由班组长到场确认。",
      "记录违规人员工号与时间点，纳入当班安全考核。",
      "检查该区域入口的 PPE 自检提示与门禁联动是否正常。",
      "每周汇总同类违规，在班前会上进行专项通报。",
    ],
    evidence: [
      { at: 0.2, text: "人员进入机加工区域，头部区域未检出安全帽" },
      { at: 0.5, text: "躯干区域无反光条带，与同画面合规人员形成对照" },
      { at: 0.78, text: "违规状态持续 8 秒以上，未发生自行纠正" },
    ],
  },
  fire: {
    id: "fire",
    scenarioLabel: "烟火异常",
    scenarioHint: "明火、浓烟、异常热源",
    ruleName: "烟火异常识别",
    severity: "critical",
    brief: "仓储区域上方出现持续扩散的灰白色烟雾，疑似初期阴燃。",
    reasoning:
      "模型在连续采样帧中检测到画面上部出现低对比度灰白色团状区域，且面积随时间单调扩大、边缘呈上升扩散形态，与水汽或灯光反射的瞬时变化特征不同。同时局部亮度在后期帧中出现橙色高亮点，符合初期阴燃向明火发展的典型视觉模式。",
    actions: [
      "立即触发区域声光报警，并通知消防值班人员前往确认。",
      "断开该区域非必要电源，疏散周边人员，打开通风与排烟设备。",
      "使用就近灭火器进行初期处置，同时准备拨打 119。",
      "保存视频与烟雾传感器数据，用于事后原因分析。",
    ],
    evidence: [
      { at: 0.15, text: "画面上部出现灰白色低对比度烟雾团" },
      { at: 0.5, text: "烟雾面积持续扩大，呈上升扩散形态" },
      { at: 0.82, text: "局部出现橙色高亮点，疑似明火" },
    ],
  },
  intrusion: {
    id: "intrusion",
    scenarioLabel: "越界入侵",
    scenarioHint: "翻越围栏、进入禁区",
    ruleName: "周界越界入侵识别",
    severity: "high",
    brief: "夜间有人员翻越周界围栏并进入禁入区域，停留时间较长。",
    reasoning:
      "模型识别到 1 名人员从围栏外侧接近并出现攀爬姿态，随后越过虚拟警戒线进入禁入区域，在警戒区内停留超过 12 秒。该时段属于非作业时间，且人员未携带任何标识物，轨迹与正常巡检路径不符，符合越界入侵规则。",
    actions: [
      "联动周界声光报警，并通过广播进行语音警告。",
      "指派最近保安前往核实，同时确认该时段是否有授权施工或维保。",
      "核查周界围栏、红外对射设备是否存在损坏或失效。",
      "如确认为未授权入侵，保留视频并通知属地安保负责人。",
    ],
    evidence: [
      { at: 0.2, text: "人员接近围栏并出现攀爬姿态" },
      { at: 0.48, text: "越过虚拟警戒线，进入禁入区域" },
      { at: 0.8, text: "在禁入区内停留超过 12 秒，无授权标识" },
    ],
  },
}

export const RULE_IDS = Object.keys(RULES) as RuleId[]

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "严重",
  high: "高危",
}
