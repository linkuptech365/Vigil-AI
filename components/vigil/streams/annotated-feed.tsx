"use client"

import * as React from "react"
import { ScanSearch } from "lucide-react"

import { Spinner } from "@/components/ui/spinner"
import { streamAnnotatedUrl } from "@/lib/vigil/vision"

const POLL_MS = 1000

/** 轮询视觉服务绘制好检测框 / Track ID 的单帧画面；视觉服务尚无帧时给出提示。 */
export function AnnotatedFeed({ streamId, name }: { streamId: string; name: string }) {
  const [src, setSrc] = React.useState<string | null>(null)
  const [empty, setEmpty] = React.useState(false)
  const currentUrl = React.useRef<string | null>(null)

  React.useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      try {
        const response = await fetch(`${streamAnnotatedUrl(streamId)}?t=${Date.now()}`, { cache: "no-store" })
        if (stopped) return
        if (response.status === 200) {
          const nextUrl = URL.createObjectURL(await response.blob())
          if (stopped) {
            URL.revokeObjectURL(nextUrl)
            return
          }
          if (currentUrl.current) URL.revokeObjectURL(currentUrl.current)
          currentUrl.current = nextUrl
          setSrc(nextUrl)
          setEmpty(false)
        } else {
          setEmpty(true)
        }
      } catch {
        if (!stopped) setEmpty(true)
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS)
    }
    void tick()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      if (currentUrl.current) {
        URL.revokeObjectURL(currentUrl.current)
        currentUrl.current = null
      }
    }
  }, [streamId])

  if (!src) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
        {empty ? <ScanSearch className="size-6" aria-hidden="true" /> : <Spinner />}
        <span className="text-xs">{empty ? "视觉服务暂无标注画面" : "正在获取标注画面…"}</span>
      </div>
    )
  }

  return (
    // 每秒更新的 blob 图片不适合 next/image 的优化管线
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={`${name} 视觉检测标注画面`} className="size-full object-cover" />
  )
}
