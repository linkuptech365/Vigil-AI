import { createHash } from "node:crypto"

export function seedFrom(value: string): number {
  return createHash("sha1").update(value).digest().readUInt32BE(0)
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SCENES = [
  { sky: "#16222b", ground: "#0d141a", line: "#2a3f4d" },
  { sky: "#1c2420", ground: "#0f1512", line: "#34463b" },
  { sky: "#232027", ground: "#131116", line: "#3d3646" },
  { sky: "#1f2430", ground: "#10131b", line: "#33405a" },
]

export interface FrameRenderOptions {
  videoSeed: number
  index: number
  total: number
  timecode: string
  motionScore: number
  peak: boolean
}

export function renderKeyframe(opts: FrameRenderOptions): string {
  const { videoSeed, index, total, timecode, motionScore, peak } = opts
  const scene = SCENES[videoSeed % SCENES.length]
  const rand = mulberry32(videoSeed)
  const horizon = 70 + Math.round(rand() * 20)

  const figures = Array.from({ length: 3 }, (_, i) => {
    const base = 40 + rand() * 200
    const drift = (rand() - 0.5) * 60 * (0.4 + motionScore)
    const x = Math.min(290, Math.max(30, base + drift * index * 0.35))
    const scale = 0.8 + rand() * 0.6
    const bodyH = 34 * scale
    const y = horizon + 24 + i * 14
    const fill = peak && i === 0 ? "#e5484d" : "#8aa2b4"
    return (
      `<g opacity="${(0.55 + motionScore * 0.4).toFixed(2)}">` +
      `<circle cx="${x.toFixed(1)}" cy="${(y - bodyH - 5).toFixed(1)}" r="${(5 * scale).toFixed(1)}" fill="${fill}"/>` +
      `<rect x="${(x - 5 * scale).toFixed(1)}" y="${(y - bodyH).toFixed(1)}" width="${(10 * scale).toFixed(1)}" height="${bodyH.toFixed(1)}" rx="3" fill="${fill}"/>` +
      `</g>`
    )
  }).join("")

  const perspective = [-80, 40, 160, 280, 400]
    .map((x) => `<line x1="${x}" y1="180" x2="${160 + (x - 160) * 0.18}" y2="${horizon}" stroke="${scene.line}" stroke-width="1"/>`)
    .join("")

  const barWidth = Math.round(motionScore * 64)
  const accent = peak ? "#e5484d" : "#4cc2a0"

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">` +
    `<rect width="320" height="180" fill="${scene.sky}"/>` +
    `<rect y="${horizon}" width="320" height="${180 - horizon}" fill="${scene.ground}"/>` +
    perspective +
    figures +
    `<rect width="320" height="180" fill="none" stroke="${accent}" stroke-width="${peak ? 3 : 0}"/>` +
    `<circle cx="14" cy="14" r="4" fill="#e5484d"/>` +
    `<text x="24" y="18" font-family="monospace" font-size="10" fill="#dce6ee">REC</text>` +
    `<text x="306" y="18" text-anchor="end" font-family="monospace" font-size="10" fill="#dce6ee">F${index + 1}/${total}</text>` +
    `<rect x="0" y="154" width="320" height="26" fill="#000000" fill-opacity="0.55"/>` +
    `<text x="10" y="171" font-family="monospace" font-size="13" font-weight="700" fill="#f2f6f9">${timecode}</text>` +
    `<rect x="246" y="163" width="64" height="5" rx="2" fill="#ffffff" fill-opacity="0.18"/>` +
    `<rect x="246" y="163" width="${barWidth}" height="5" rx="2" fill="${accent}"/>` +
    `</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
