import type { AuditSnapshot, CapaFormState, GmpDeviationRecord } from "../audit-types"

function log(id: string, at: string, actor: string, action: string) {
  return { id, at, actor, action }
}

const SEED_RECORDS: GmpDeviationRecord[] = [
  {
    id: "DEV-20261020-001",
    ruleId: "BIO-01",
    channelId: "CAM-02",
    zone: "B级走廊更衣室",
    behavior: "防静电鞋未穿戴",
    clause: "GMP附录1第18条",
    classification: "MAJOR",
    occurredAt: "2026-10-20 08:14:32",
    sha256: "7282db5f43912ff8f89c5c11627000d65a511c98fc8ae229eccfa61cdcf3af2c",
    operator: "王静",
    shiftLead: "刘洋",
    capaStatus: "DRAFT",
    vlmExcerpt:
      "操作员跨过阻隔凳时未更换防静电无尘鞋，直接穿着便鞋进入生产走廊，接触时长 18 秒。",
    confidence: 0.96,
    clipStartSec: 8,
    clipEndSec: 16,
    auditLog: [
      log("L-001-1", "2026-10-20T00:14:34.000Z", "Vigil 规则引擎", "命中规则 BIO-01，自动生成偏差记录"),
    ],
  },
  {
    id: "DEV-20261020-002",
    ruleId: "BIO-02",
    channelId: "CAM-04",
    zone: "气锁传递窗",
    behavior: "传递窗双门同时开启",
    clause: "GMP附录1第9条",
    classification: "CRITICAL",
    occurredAt: "2026-10-20 09:41:07",
    sha256: "8fd82337a24a2d7aa59889f39be6e7c03f504dfd05f200d3195d40132ea2bf5b",
    operator: "赵敏",
    shiftLead: "孙海",
    capaStatus: "IN_PROGRESS",
    vlmExcerpt:
      "传递物料时内外两侧门体在约 6 秒内同时处于开启状态，未等待互锁复位，洁净区与非洁净区之间出现直接气流通路。",
    confidence: 0.94,
    clipStartSec: 10,
    clipEndSec: 18,
    auditLog: [
      log("L-002-1", "2026-10-20T01:41:09.000Z", "Vigil 规则引擎", "命中规则 BIO-02，自动生成偏差记录"),
      log("L-002-2", "2026-10-20T02:05:00.000Z", "孙海", "保存 CAPA 草稿，进入纠正措施执行"),
    ],
  },
  {
    id: "DEV-20261020-003",
    ruleId: "BIO-03",
    channelId: "CAM-03",
    zone: "A级灌装加塞核心区",
    behavior: "手臂越过层流屏障",
    clause: "GMP附录1第8.9条",
    classification: "CRITICAL",
    occurredAt: "2026-10-20 11:26:55",
    sha256: "8feefaca56f5b33e52ce08ce3fb0c752d1469adbedddd5d63cc27194944d1465",
    operator: "周凯",
    shiftLead: "孙海",
    capaStatus: "QA_REVIEW",
    vlmExcerpt:
      "操作员为取回掉落的胶塞，手臂越过 A 级区层流屏障并在开放容器上方停留约 4 秒，破坏单向流保护。",
    confidence: 0.97,
    clipStartSec: 12,
    clipEndSec: 20,
    auditLog: [
      log("L-003-1", "2026-10-20T03:26:57.000Z", "Vigil 规则引擎", "命中规则 BIO-03，自动生成偏差记录"),
      log("L-003-2", "2026-10-20T04:10:00.000Z", "孙海", "提交 QA 质保复核"),
    ],
  },
  {
    id: "DEV-20261020-004",
    ruleId: "BIO-04",
    channelId: "CAM-01",
    zone: "培养物取样间",
    behavior: "取样交接单签名延迟",
    clause: "GMP第9章第9.22条",
    classification: "MINOR",
    occurredAt: "2026-10-20 13:05:18",
    sha256: "55c76673da51842a2e58f5e35b6e6269efa08ead0ecf0f51567e0d27614e9a28",
    operator: "陈晓",
    shiftLead: "刘洋",
    capaStatus: "APPROVED",
    vlmExcerpt:
      "取样动作、手套更换与器具消毒均符合 SOP，仅交接单签名比规程要求晚约 2 分钟，不影响产品质量，作为合规基线样本归档。",
    confidence: 0.91,
    clipStartSec: 2,
    clipEndSec: 10,
    auditLog: [
      log("L-004-1", "2026-10-20T05:05:20.000Z", "Vigil 规则引擎", "命中规则 BIO-04，自动生成偏差记录"),
      log("L-004-2", "2026-10-20T06:30:00.000Z", "陈质保", "批准 CAPA 并结案，已电子签名"),
    ],
  },
]

const SEED_CAPA: CapaFormState[] = [
  {
    deviationId: "DEV-20261020-001",
    rcaCategory: "HUMAN_ERROR",
    rcaNotes: "",
    containment: "",
    capaPlan: "",
    plannedDate: "",
    qaOfficer: "",
    signedAt: null,
    returnReason: null,
    updatedAt: "2026-10-20T00:14:34.000Z",
  },
  {
    deviationId: "DEV-20261020-002",
    rcaCategory: "INTERLOCK_FAULT",
    rcaNotes: "传递窗电磁互锁在连续开关 3 次后未复位，初步判断为互锁继电器粘连。",
    containment: "立即停用该传递窗，改用备用传递窗；对已传递的物料批次重新进行表面消毒与微生物抽检。",
    capaPlan: "更换互锁继电器，并将互锁状态接入监控平台，开门间隔小于 15 秒时自动报警。",
    plannedDate: "2026-11-05",
    qaOfficer: "",
    signedAt: null,
    returnReason: null,
    updatedAt: "2026-10-20T02:05:00.000Z",
  },
  {
    deviationId: "DEV-20261020-003",
    rcaCategory: "HUMAN_ERROR",
    rcaNotes: "操作员未使用长柄夹具，直接伸手取回胶塞；SOP 中缺少掉落物处理的明确步骤。",
    containment: "暂停该灌装线，对当批已灌装产品隔离留样；对 A 级区进行动态微粒与浮游菌监测。",
    capaPlan: "修订 SOP-BIO-031 增加掉落物处理流程，全体 A 级区人员 7 日内完成再培训并考核。",
    plannedDate: "2026-11-12",
    qaOfficer: "",
    signedAt: null,
    returnReason: null,
    updatedAt: "2026-10-20T04:10:00.000Z",
  },
  {
    deviationId: "DEV-20261020-004",
    rcaCategory: "ENVIRONMENT",
    rcaNotes: "取样间交接单放置位置距离操作台较远，造成签名延迟，无其他质量影响。",
    containment: "无需隔离，已补签交接单并附情况说明。",
    capaPlan: "将交接单夹板移至取样台旁，并在 SOP 中补充签名时限提示。",
    plannedDate: "2026-10-27",
    qaOfficer: "陈质保 (QA Supervisor)",
    signedAt: "2026-10-20T06:30:00.000Z",
    returnReason: null,
    updatedAt: "2026-10-20T06:30:00.000Z",
  },
]

export function createSeedSnapshot(): AuditSnapshot {
  return {
    records: SEED_RECORDS.map((record) => ({ ...record, auditLog: [...record.auditLog] })),
    capa: Object.fromEntries(SEED_CAPA.map((item) => [item.deviationId, { ...item }])),
  }
}

export const SERVER_SNAPSHOT: AuditSnapshot = createSeedSnapshot()
