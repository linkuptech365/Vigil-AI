export type Vec2 = readonly [number, number]

const EPSILON = 1e-9

/** Signed area of the triangle A-B-P: positive when P is left of A->B in a y-down frame's math sense. */
export function lineSide(p: Vec2, a: Vec2, b: Vec2) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/**
 * Classic ray-casting point-in-polygon test: cast a ray to +x and count edge crossings.
 * Points lying on an edge count as inside so a target touching the red line is never missed.
 */
export function pointInPolygon(point: Vec2, polygon: readonly Vec2[]) {
  if (polygon.length < 3) return false
  const [x, y] = point

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (distanceToSegment(point, polygon[j], polygon[i]) <= EPSILON) return true
  }

  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const straddles = yi > y !== yj > y
    if (straddles && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function orientation(a: Vec2, b: Vec2, c: Vec2) {
  const value = lineSide(c, a, b)
  if (Math.abs(value) <= EPSILON) return 0
  return value > 0 ? 1 : -1
}

function onSegment(a: Vec2, b: Vec2, p: Vec2) {
  return (
    p[0] >= Math.min(a[0], b[0]) - EPSILON &&
    p[0] <= Math.max(a[0], b[0]) + EPSILON &&
    p[1] >= Math.min(a[1], b[1]) - EPSILON &&
    p[1] <= Math.max(a[1], b[1]) + EPSILON
  )
}

export function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2) {
  const o1 = orientation(p1, p2, q1)
  const o2 = orientation(p1, p2, q2)
  const o3 = orientation(q1, q2, p1)
  const o4 = orientation(q1, q2, p2)

  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(p1, p2, q1)) return true
  if (o2 === 0 && onSegment(p1, p2, q2)) return true
  if (o3 === 0 && onSegment(q1, q2, p1)) return true
  if (o4 === 0 && onSegment(q1, q2, p2)) return true
  return false
}

export interface TripwireCrossing {
  crossed: boolean
  /** True when the crossing counts as a violation (always true for bidirectional wires). */
  wrongWay: boolean
}

/**
 * Detects whether the movement prev -> curr crosses the wire A-B within its span.
 * Directional wires follow the perception engine convention: landing on the positive
 * side of A->B (lineSide > 0) is the forbidden direction.
 */
export function detectTripwireCrossing(
  prev: Vec2,
  curr: Vec2,
  a: Vec2,
  b: Vec2,
  directional: boolean
): TripwireCrossing {
  const before = lineSide(prev, a, b)
  const after = lineSide(curr, a, b)
  const crossed = before * after < 0 && segmentsIntersect(prev, curr, a, b)
  return { crossed, wrongWay: directional ? after > 0 : true }
}
