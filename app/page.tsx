import type { Metadata } from "next"

import { OpsCenter } from "@/components/ops/ops-center"

export const metadata: Metadata = {
  title: "作业大屏 | Vigil-AI",
  description: "Vigil-AI 视频核心作业大屏：实时监控矩阵、AI 研判告警流、自然语言视频检索与布控规则。",
}

export default function Page() {
  return <OpsCenter />
}
