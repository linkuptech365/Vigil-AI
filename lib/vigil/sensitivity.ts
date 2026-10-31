export type Tier1Sensitivity = "high" | "standard" | "low"

export interface Tier1Config {
  mode: Tier1Sensitivity
  /** 完整档位名，用于日志和徽章，如「高灵敏模式」 */
  modeName: string
  /** 档位适用场景，用于配置面板说明 */
  scene: string
  description: string
  /** 像素变动率阈值，单位 %（相邻帧变化像素占比超过它才算动作） */
  motionThresholdPercent: number
  /** 单个像素的灰度差阈值（0-255），超过才算该像素发生变化 */
  grayDiff: number
  /** 长静止区间的强制巡检间隔（秒） */
  patrolIntervalSeconds: number
}

/** 长静止区间至少每隔这么多秒强制抽 1 帧送检，确保静止坐姿等违规不漏检 */
export const PATROL_INTERVAL_SECONDS = 45

export const DEFAULT_TIER1_SENSITIVITY: Tier1Sensitivity = "standard"

export const TIER1_PRESETS: Record<Tier1Sensitivity, Tier1Config> = {
  high: {
    mode: "high",
    modeName: "高灵敏模式",
    scene: "洁净室精密操作",
    description: "捕捉手指触碰瓶口等微小动作，漏检最少，送检帧数会增加。",
    motionThresholdPercent: 1.5,
    grayDiff: 16,
    patrolIntervalSeconds: PATROL_INTERVAL_SECONDS,
  },
  standard: {
    mode: "standard",
    modeName: "标准模式",
    scene: "常规车间",
    description: "默认档位，兼顾动作捕捉与送检成本。",
    motionThresholdPercent: 3,
    grayDiff: 24,
    patrolIntervalSeconds: PATROL_INTERVAL_SECONDS,
  },
  low: {
    mode: "low",
    modeName: "抗噪模式",
    scene: "光影晃动场景",
    description: "过滤镜头抖动和光线变化，避免整片被误判为动作活跃。",
    motionThresholdPercent: 6,
    grayDiff: 32,
    patrolIntervalSeconds: PATROL_INTERVAL_SECONDS,
  },
}

export const TIER1_ORDER: Tier1Sensitivity[] = ["high", "standard", "low"]

export function isTier1Sensitivity(value: unknown): value is Tier1Sensitivity {
  return value === "high" || value === "standard" || value === "low"
}

/** 非法或缺失的值一律回退到标准模式，兼容旧版本存下来的配置 */
export function resolveTier1Config(mode?: unknown): Tier1Config {
  return TIER1_PRESETS[isTier1Sensitivity(mode) ? mode : DEFAULT_TIER1_SENSITIVITY]
}

export function formatThresholdPercent(value: number) {
  return Number.isInteger(value) ? `${value}.0` : String(value)
}

/** 如「高灵敏模式 (1.5%)」 */
export function tier1BadgeText(config: Tier1Config) {
  return `${config.modeName} (${formatThresholdPercent(config.motionThresholdPercent)}%)`
}
