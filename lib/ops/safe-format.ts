export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return fallback
  const result = numerator / denominator
  return Number.isFinite(result) ? result : fallback
}

/** 返回 0-100 的百分比数值，分母为 0 或结果非法时返回 fallback。 */
export function safePercent(numerator: number, denominator: number, fallback = 0): number {
  return safeDivide(numerator, denominator, fallback / 100) * 100
}

/** 格式化百分比数字（不带 % 符号），统一规避 NaN / Infinity。 */
export function formatPercent(numerator: number, denominator: number, fallback = "0.0", digits = 1): string {
  const value = safeDivide(numerator, denominator, Number.NaN) * 100
  return Number.isFinite(value) ? value.toFixed(digits) : fallback
}

/** 格式化已是百分比的数值，非法值（NaN / Infinity）返回 fallback。 */
export function formatPercentValue(value: number, fallback = "0.0", digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : fallback
}

/** 格式化美元金额，非法值返回 fallback。 */
export function formatUsd(value: number, fallback = "$0.00"): string {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : fallback
}
