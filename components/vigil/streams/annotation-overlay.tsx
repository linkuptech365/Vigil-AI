"use client"

import * as React from "react"

import { streamOverlayUrl } from "@/lib/vigil/vision"

const POLL_MS = 800

interface AnnotationOverlayProps {
  streamId: string
  /** 通道不可见 / 关闭标注时不轮询 */
  active: boolean
  /** 图层是否已有有效帧；调用方可据此显示"等待标注"提示 */
  onReadyChange?: (ready: boolean) => void
}

/**
 * 叠在原始视频上方的透明 Canvas。只负责绘制检测框、电子围栏、记忆锚点；
 * 拿不到图层时仅清空画布，永远不会遮挡或替换底层视频。
 */
export function AnnotationOverlay({ streamId, active, onReadyChange }: AnnotationOverlayProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const readyRef = React.useRef(false)
  const onReadyChangeRef = React.useRef(onReadyChange)
  React.useEffect(() => {
    onReadyChangeRef.current = onReadyChange
  }, [onReadyChange])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!active || !canvas) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()

    const setReady = (ready: boolean) => {
      if (readyRef.current === ready) return
      readyRef.current = ready
      onReadyChangeRef.current?.(ready)
    }
    const clear = () => canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height)

    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch(`${streamOverlayUrl(streamId)}?t=${Date.now()}`, {
            cache: "no-store",
            signal: controller.signal,
          })
          if (stopped) return
          if (response.status === 200) {
            const bitmap = await createImageBitmap(await response.blob())
            if (stopped) {
              bitmap.close()
              return
            }
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
              canvas.width = bitmap.width
              canvas.height = bitmap.height
            }
            const context = canvas.getContext("2d")
            context?.clearRect(0, 0, canvas.width, canvas.height)
            context?.drawImage(bitmap, 0, 0)
            bitmap.close()
            setReady(true)
          } else {
            clear()
            setReady(false)
          }
        } catch {
          if (stopped) return
          clear()
          setReady(false)
        }
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS)
    }
    void tick()

    return () => {
      stopped = true
      controller.abort()
      if (timer) clearTimeout(timer)
      clear()
      setReady(false)
    }
  }, [streamId, active])

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full object-cover" />
}
