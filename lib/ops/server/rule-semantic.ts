interface Concept {
  tag: string
  label: string
  keywords: string[]
}

const CONCEPTS: Concept[] = [
  {
    tag: "conflict",
    label: "肢体冲突",
    keywords: ["冲突", "打架", "斗殴", "推搡", "撕扯", "挥击", "握拳", "攻击", "肢体", "纠缠", "扭打", "对抗"],
  },
  {
    tag: "fire",
    label: "烟火隐患",
    keywords: ["烟雾", "明火", "火焰", "着火", "起火", "火苗", "冒烟", "火情"],
  },
  {
    tag: "ppe",
    label: "劳保穿戴违规",
    keywords: ["安全帽", "反光背心", "未戴", "未穿戴", "劳保", "防护服"],
  },
  {
    tag: "fall",
    label: "人员摔倒",
    keywords: ["摔倒", "倒地", "仰卧", "侧卧", "跌倒", "未自行站起"],
  },
  {
    tag: "intrusion",
    label: "越界闯入",
    keywords: ["闯入", "越界", "翻越", "禁区", "红线", "围栏", "绊线", "入侵", "越过", "逃窜"],
  },
  {
    tag: "gathering",
    label: "人员聚集",
    keywords: ["聚集", "围观", "扎堆", "人群"],
  },
  {
    tag: "vehicle",
    label: "车辆违规",
    keywords: ["逆行", "超速", "叉车", "车辆"],
  },
]

const TAG_LABEL = new Map(CONCEPTS.map((concept) => [concept.tag, concept.label]))

export function tagLabel(tag: string) {
  return TAG_LABEL.get(tag) ?? tag
}

export function extractTags(text: string): string[] {
  return CONCEPTS.filter((concept) => concept.keywords.some((keyword) => text.includes(keyword))).map(
    (concept) => concept.tag
  )
}

function bigrams(text: string) {
  const clean = text.replace(/[\s\p{P}\p{S}]/gu, "")
  const grams = new Set<string>()
  for (let i = 0; i < clean.length - 1; i++) grams.add(clean.slice(i, i + 2))
  return grams
}

export interface SemanticMatch {
  matched: boolean
  sharedTags: string[]
  /** 0~1, share of the rule's concept tags (or bigram coverage) found in the scenario. */
  score: number
}

const BIGRAM_COVERAGE_MIN = 0.3
const BIGRAM_OVERLAP_MIN = 3

/**
 * Matches a VLM scenario description against a rule prompt.
 * Concept tags catch synonyms ("推搡" vs "打架"); a bigram overlap fallback covers custom prompts
 * whose subject is outside the built-in concept lexicon.
 */
export function matchScenario(ruleText: string, scenarioText: string): SemanticMatch {
  const ruleTags = extractTags(ruleText)
  const sceneTags = new Set(extractTags(scenarioText))
  const sharedTags = ruleTags.filter((tag) => sceneTags.has(tag))

  if (sharedTags.length > 0) {
    return { matched: true, sharedTags, score: sharedTags.length / ruleTags.length }
  }

  const ruleGrams = bigrams(ruleText)
  const sceneGrams = bigrams(scenarioText)
  if (sceneGrams.size === 0) return { matched: false, sharedTags: [], score: 0 }

  let overlap = 0
  for (const gram of sceneGrams) if (ruleGrams.has(gram)) overlap += 1
  const coverage = overlap / sceneGrams.size
  return {
    matched: overlap >= BIGRAM_OVERLAP_MIN && coverage >= BIGRAM_COVERAGE_MIN,
    sharedTags: [],
    score: coverage,
  }
}
