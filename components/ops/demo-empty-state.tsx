"use client"

import { DatabaseZap } from "lucide-react"
import type { ReactNode } from "react"

import { useDemoMode } from "@/components/vigil/demo-mode-provider"

interface DemoEmptyStateProps {
  title: string
  description: string
}

export function DemoEmptyState({ title, description }: DemoEmptyStateProps) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card/40 px-6 py-12 text-center"
    >
      <DatabaseZap className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

interface DemoOnlyProps {
  children: ReactNode
  fallback: ReactNode
}

/** 仅在演示数据开关开启时渲染 children，关闭时渲染真实空态。 */
export function DemoOnly({ children, fallback }: DemoOnlyProps) {
  const { enabled } = useDemoMode()
  return enabled ? children : fallback
}
