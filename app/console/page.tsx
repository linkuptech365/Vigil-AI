import type { Metadata } from "next"

import { VigilApp } from "@/components/vigil/vigil-app"

export const metadata: Metadata = {
  title: "配置中心 | Vigil-AI",
  description: "Vigil-AI 配置中心：API Key 管理、监控目录扫描与视频分析队列测试。",
}

export default function ConsolePage() {
  return (
    <main>
      <VigilApp />
    </main>
  )
}
