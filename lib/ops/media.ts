import type { SyntheticEvent } from "react"

const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">' +
  '<rect width="640" height="360" fill="#111827"/>' +
  '<path d="M0 180h640M320 0v360" stroke="#1f2937" stroke-width="1"/>' +
  '<text x="320" y="186" fill="#6b7280" font-family="monospace" font-size="16" text-anchor="middle">NO SIGNAL</text>' +
  "</svg>"

/** Inline fallback so a missing image never produces a network request or a 404. */
export const PLACEHOLDER_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(PLACEHOLDER_SVG)}`

export function hasMediaSrc(src: string | null | undefined): src is string {
  return typeof src === "string" && src.trim().length > 0
}

/** Detach the handler so a failing resource cannot re-trigger it. */
export function suppressMediaError(event: SyntheticEvent<HTMLImageElement | HTMLVideoElement>) {
  event.currentTarget.onerror = null
}

export function handleImageError(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget
  image.onerror = null
  if (image.src !== PLACEHOLDER_IMAGE) image.src = PLACEHOLDER_IMAGE
}

export function safePlay(video: HTMLMediaElement | null | undefined) {
  if (!video) return
  try {
    const playPromise = video.play()
    if (playPromise !== undefined) {
      playPromise.catch(() => {})
    }
  } catch {
    // Some browsers throw synchronously when the element has no usable source.
  }
}
