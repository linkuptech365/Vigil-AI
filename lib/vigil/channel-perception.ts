import type { Tier1LearningState } from "./tier1-learning"
import type { VocabularyItem } from "./vision"

/** 通道专属编译词条，与全局词表词条同构。 */
export type CompiledTag = VocabularyItem

export interface ChannelPerceptionConfig {
  channelId: string
  /** 中文稽查描述，例如 1 楼为「快递或外卖小哥」，2 楼为「猫吃猫粮」 */
  raw_prompt: string
  /** 该通道专属编译词表；为空表示尚未配置，仅使用人员锚点基线 */
  compiled_tags: CompiledTag[]
  /** 该通道专属记忆锚点与自优化状态 */
  learning_state: Tier1LearningState
}

/** 落盘结构：只存用户可编辑的部分，学习状态由 tier1-learning 存储维护。 */
export interface StoredChannelPerception {
  raw_prompt: string
  compiled_tags: CompiledTag[]
  updatedAt: string
}

export interface ChannelCompileSummary {
  source: "llm" | "fallback"
  model?: string
  note: string
  mode: "append" | "replace"
  /** 本次编译模型给出的词条 */
  tags: CompiledTag[]
  added: number
  skipped: number
  reenabled: number
}

/** 通道上一条已启用规则的概要。 */
export interface ActiveRuleInfo {
  id: string
  name: string
  /** 规则是否配置了通用管道；没有管道的规则不产生任何检测词条 */
  hasPipeline: boolean
}

/** 由已启用规则派生出的一个检测要素（触发主体或伴生物体）。 */
export interface ActiveClass {
  promptEn: string
  kind: "subject" | "context"
  ruleIds: string[]
  ruleNames: string[]
  /** 是否已有对应的编译词条（带中文名与角色）；没有时由 Worker 以管道类别方式注入 */
  inVocabulary: boolean
  labelZh: string
}

/** 通道当前规则绑定：词表的唯一来源。 */
export interface ChannelRuleBinding {
  rules: ActiveRuleInfo[]
  classes: ActiveClass[]
  /** 存在以 "*" 作为触发主体的规则（任意已检出主体） */
  wildcard: boolean
}

export interface ChannelConfigResponse {
  status: "ok"
  config: ChannelPerceptionConfig
  /** 该通道是否已有生效词表（已启用规则或专属词条）；仅剩人员锚点基线时为 false */
  configured: boolean
  /** 词表来源：rules 为规则引用类别 ∪ 专属词条；custom 为无启用规则、仅专属词条；baseline 为仅人员锚点基线 */
  source: "rules" | "custom" | "baseline"
  /** 视觉服务实际使用的词表（专属词条 ∪ 规则引用类别，或人员锚点基线） */
  effective_tags: CompiledTag[]
  /** 当前通道的规则绑定与由规则派生的检测要素 */
  binding: ChannelRuleBinding
  /** 已持久化但没有被任何已启用规则引用的词条（手动编译 / 反哺并入）：同样生效并下发 Worker */
  orphan_tags: CompiledTag[]
  updatedAt: string | null
  compile?: ChannelCompileSummary
  reload?: { ok: boolean; reloadMs: number; message: string }
}

export const CHANNEL_CONFIG_ENDPOINT = "/api/v1/vision/channel-config"

export function channelConfigUrl(channelId: string) {
  return `${CHANNEL_CONFIG_ENDPOINT}?channelId=${encodeURIComponent(channelId)}`
}
