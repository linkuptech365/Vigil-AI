export type Point = [number, number]

export const FRAME_ASPECT = 1408 / 768

export function pathLength(path: Point[]) {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  }
  return total
}

function pointAt(path: Point[], distance: number): Point {
  let remaining = Math.max(distance, 0)
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
    if (remaining <= seg || i === path.length - 1) {
      const t = seg === 0 ? 0 : Math.min(remaining / seg, 1)
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
      ]
    }
    remaining -= seg
  }
  return path[path.length - 1]
}

/** Walks the polyline forward and back so targets patrol their lane endlessly. */
export function samplePingPong(path: Point[], distance: number): Point {
  const total = pathLength(path)
  if (total === 0) return path[0]
  const m = distance % (total * 2)
  return pointAt(path, m > total ? total * 2 - m : m)
}

export function samplePath(path: Point[], distance: number): Point {
  return pointAt(path, distance)
}

export function pointInPolygon(point: Point, polygon: Point[]) {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Sign tells which side of the A->B line the point sits on. */
export function lineSide(point: Point, a: Point, b: Point) {
  return (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])
}

/** Position of the point projected on A->B, 0 at A and 1 at B. */
export function projectOnSegment(point: Point, a: Point, b: Point) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  return len2 === 0 ? 0 : ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2
}

/** Screen angle (deg) of the permitted crossing direction, corrected for the 16:9-ish frame. */
export function allowedAngle(a: Point, b: Point) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return (Math.atan2(-dx * FRAME_ASPECT, dy) * 180) / Math.PI
}

export function midpoint(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}
