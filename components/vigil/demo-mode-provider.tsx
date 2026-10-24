"use client"

import * as React from "react"

import { setAuditDemoMode } from "@/lib/ops/storage/audit-storage"

interface DemoModeValue {
  /** 是否展示演示/模拟数据；默认 false，所有页面只呈现真实数据 */
  enabled: boolean
  pending: boolean
  setEnabled: (next: boolean) => Promise<void>
}

const DemoModeContext = React.createContext<DemoModeValue>({
  enabled: false,
  pending: false,
  setEnabled: async () => {},
})

export function useDemoMode() {
  return React.useContext(DemoModeContext)
}

/**
 * 初值由根布局在服务端读取，首屏即为正确状态，不会先闪一帧演示数据。
 * 切换后以 key 重新挂载子树，各 Provider 会按新模式重新初始化状态。
 */
export function DemoModeProvider({ initial, children }: { initial: boolean; children: React.ReactNode }) {
  const [enabled, setEnabledState] = React.useState(initial)
  const [pending, setPending] = React.useState(false)
  setAuditDemoMode(enabled)

  const setEnabled = React.useCallback(async (next: boolean) => {
    setPending(true)
    try {
      const response = await fetch("/api/v1/settings/demo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? `HTTP ${response.status}`)
      }
      setEnabledState(next)
    } finally {
      setPending(false)
    }
  }, [])

  const value = React.useMemo(() => ({ enabled, pending, setEnabled }), [enabled, pending, setEnabled])

  return (
    <DemoModeContext.Provider value={value}>
      <React.Fragment key={enabled ? "demo" : "live"}>{children}</React.Fragment>
    </DemoModeContext.Provider>
  )
}
