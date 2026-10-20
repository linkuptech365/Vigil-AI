export type ScenarioKind = "violence" | "intrusion" | "ppe" | "fire" | "crowd" | "safe"

const PATTERNS: ReadonlyArray<readonly [Exclude<ScenarioKind, "safe">, RegExp]> = [
  ["violence", /打架|斗殴|冲突|肢体|推搡|殴打|暴力/],
  ["intrusion", /入侵|禁区|围栏|越界|翻越|闯入|警戒线/],
  ["ppe", /反光衣|头盔|安全帽|防护装备|劳保|PPE/i],
  ["fire", /烟火|明火|火焰|火灾|烟雾|冒烟/],
  ["crowd", /聚集|围拢|拥堵|阻塞|滞留/],
]

export function classifyScenario(text: string | undefined): ScenarioKind {
  if (!text) return "safe"
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(text)) return kind
  }
  return "safe"
}
