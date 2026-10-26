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

export interface ChannelConfigResponse {
  status: "ok"
  config: ChannelPerceptionConfig
  /** 该通道是否已有专属词表 */
  configured: boolean
  /** 视觉服务实际使用的基础词表来源：channel 为本通道专属词表，baseline 为未配置时的人员锚点基线 */
  source: "channel" | "baseline"
  /** 视觉服务实际使用的基础词表（本通道专属词表，或人员锚点基线） */
  effective_tags: CompiledTag[]
  updatedAt: string | null
  compile?: ChannelCompileSummary
  reload?: { ok: boolean; reloadMs: number; message: string }
}

export const CHANNEL_CONFIG_ENDPOINT = "/api/v1/vision/channel-config"

export function channelConfigUrl(channelId: string) {
  return `${CHANNEL_CONFIG_ENDPOINT}?channelId=${encodeURIComponent(channelId)}`
}
