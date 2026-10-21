import type { InspectionRule } from "./rules-types"

export type GmpSeverity = "WARNING" | "CRITICAL" | "SAFE"

export interface GmpCase {
  caseId: string
  fileName: string
  scenarioName: string
  behavior: string
  severity: GmpSeverity
  confidence: number
  ruleId: string
  ruleName: string
  /** SAFE 算例没有扣分项 */
  gmpDeduction: string | null
  durationSec: number
  width: number
  height: number
  sizeKB: number
}

export interface GmpProvisionedCase extends GmpCase {
  path: string
  sizeBytes: number
}

export interface GmpProvisionResponse {
  status: "success"
  suite: "vaccine-cleanroom-gmp"
  directory: string
  cases: GmpProvisionedCase[]
  rules: InspectionRule[]
  generatedAt: string
  /** true 表示算例是有效的 H.264 MP4，可在浏览器中解码播放；false 表示仅含容器头部的占位文件 */
  playable: boolean
  note: string
}

export const GMP_SUITE_LABEL = "载入疫苗洁净室 GMP 算例 (Load GMP Suite)"

export const GMP_CASES: readonly GmpCase[] = [
  {
    caseId: "BIO-01",
    fileName: "case_bio_01_esd_shoes_violation.mp4",
    scenarioName: "B级更衣室/进入生产区防静电鞋合规检测",
    behavior:
      "操作人员更衣后未换穿防静电无尘鞋（穿着日常便鞋/破损鞋套直接跨过红线阻隔凳进入走廊）。",
    severity: "WARNING",
    confidence: 0.93,
    ruleId: "RULE-BIO-01",
    ruleName: "洁净区防静电无尘鞋/鞋套穿戴违规检测",
    gmpDeduction: "违反《药品生产质量管理规范》洁净室人员卫生防护附录第18条",
    durationSec: 24,
    width: 1920,
    height: 1080,
    sizeKB: 384,
  },
  {
    caseId: "BIO-02",
    fileName: "case_bio_02_aseptic_transfer_collision.mp4",
    scenarioName: "疫苗灌装组件气锁传递窗异常碰撞与交叉污染",
    behavior:
      "灭菌后的无菌储液包与连接管路在通过传递窗转运时，操作人员动作过大导致无菌袋外壁与传递窗门框发生剧烈刮擦碰撞，存在微孔破损与洁净度降级风险。",
    severity: "CRITICAL",
    confidence: 0.95,
    ruleId: "RULE-BIO-02",
    ruleName: "无菌器具传递通道碰撞与防交叉污染监控",
    gmpDeduction: "违反无菌药品附录关键物料单向流转与保护规定",
    durationSec: 32,
    width: 1920,
    height: 1080,
    sizeKB: 512,
  },
  {
    caseId: "BIO-03",
    fileName: "case_bio_03_class_a_zone_touch.mp4",
    scenarioName: "A级灌装加塞核心区未授权触碰阻断",
    behavior:
      "灌装机运转中，人员手臂违规伸入 A 级垂直层流罩内部，且手部触碰了未封口的瓶口轨道区域（非紧急故障排险程序，且未经过长柄无菌工具操作）。",
    severity: "CRITICAL",
    confidence: 0.97,
    ruleId: "RULE-BIO-03",
    ruleName: "A级层流关键控制区未授权触碰与越界阻断",
    gmpDeduction: "属于重大无菌保障污染偏差，需立即实施紧急隔离阻断",
    durationSec: 18,
    width: 2560,
    height: 1440,
    sizeKB: 640,
  },
  {
    caseId: "BIO-04",
    fileName: "case_bio_04_standard_gmp_operation.mp4",
    scenarioName: "疫苗培养物取样常态规范作业",
    behavior: "全程穿戴防静电服与灭菌手套，缓慢平稳操作，无碰壁，无越界。",
    severity: "SAFE",
    confidence: 0.99,
    ruleId: "RULE-BIO-04",
    ruleName: "疫苗生产常态化合规作业标准参照",
    gmpDeduction: null,
    durationSec: 40,
    width: 1920,
    height: 1080,
    sizeKB: 448,
  },
]

const GMP_CHANNELS = ["CAM-01", "CAM-02", "CAM-03", "CAM-04"]

/** 预置进服务端规则库的 3 条违规规则（BIO-04 仅作为合规对照，不入库）。 */
export const GMP_RULE_SEEDS: InspectionRule[] = [
  {
    id: "RULE-BIO-01",
    name: "洁净区防静电无尘鞋/鞋套穿戴违规检测",
    type: "PROMPT_SEMANTIC",
    prompt: "B级更衣室出口人员未更换防静电无尘鞋，穿着日常便鞋或破损鞋套跨过红线阻隔凳进入生产走廊",
    boundChannels: [...GMP_CHANNELS],
    severity: "WARNING",
    cooldownSeconds: 60,
    schedule: "24x7",
    enabled: true,
    sensitivity: 0.9,
    actions: { webhook: true, dispatch: true, siren: false },
  },
  {
    id: "RULE-BIO-02",
    name: "无菌器具传递通道碰撞与防交叉污染监控",
    type: "PROMPT_SEMANTIC",
    prompt: "无菌储液包或连接管路经传递窗转运时与门框发生刮擦碰撞，存在微孔破损与洁净度降级风险",
    boundChannels: [...GMP_CHANNELS],
    severity: "CRITICAL",
    cooldownSeconds: 60,
    schedule: "24x7",
    enabled: true,
    sensitivity: 0.9,
    actions: { webhook: true, dispatch: true, siren: true },
  },
  {
    id: "RULE-BIO-03",
    name: "A级层流关键控制区未授权触碰与越界阻断",
    type: "PROMPT_SEMANTIC",
    prompt: "灌装机运转中人员手臂伸入A级垂直层流罩，触碰未封口瓶口轨道，且未使用长柄无菌工具",
    boundChannels: [...GMP_CHANNELS],
    severity: "CRITICAL",
    cooldownSeconds: 30,
    schedule: "24x7",
    enabled: true,
    sensitivity: 0.95,
    actions: { webhook: true, dispatch: true, siren: true },
  },
]
