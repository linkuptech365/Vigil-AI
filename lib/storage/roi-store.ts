import fs from "node:fs"
import path from "node:path"

import type { RoiAction, RoiSeverity, RoiShape, RoiZone, TrackClass } from "@/lib/ops/perception-types"
import { dataDir } from "./rules-store"

export const MAX_ZONES = 60
const MAX_POLYGON_POINTS = 16
const TRACK_CLASSES: TrackClass[] = ["person", "vehicle", "forklift", "hazard"]

export function roiZonesPath() {
  return path.join(dataDir(), "roi-zones.json")
}

function clampPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100
}

function sanitizeCoordinates(value: unknown, type: RoiShape): [number, number][] | null {
  if (!Array.isArray(value)) return null
  const points: [number, number][] = []
  for (const raw of value) {
    if (!Array.isArray(raw) || raw.length !== 2) return null
    const x = clampPercent(raw[0])
    const y = clampPercent(raw[1])
    if (x === null || y === null) return null
    points.push([x, y])
  }
  if (type === "tripwire") return points.length === 2 ? points : null
  return points.length >= 3 && points.length <= MAX_POLYGON_POINTS ? points : null
}

/** 校验并规整围栏列表：坐标限定在 0-100 百分比，非法条目直接丢弃。 */
export function sanitizeZones(input: unknown): RoiZone[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const zones: RoiZone[] = []
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue
    const item = raw as Record<string, unknown>
    const type: RoiShape | null = item.type === "polygon" || item.type === "tripwire" ? item.type : null
    if (!type) continue
    const coordinates = sanitizeCoordinates(item.coordinates, type)
    if (!coordinates) continue
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 40) : `Z-${Date.now().toString(36)}-${zones.length}`
    if (seen.has(id)) continue
    seen.add(id)
    const severity: RoiSeverity = item.severity === "warning" ? "warning" : "critical"
    const action: RoiAction = item.action === "log" || item.action === "siren" ? item.action : "escalate"
    const targets = Array.isArray(item.targets)
      ? item.targets.filter((t): t is TrackClass => TRACK_CLASSES.includes(t as TrackClass))
      : []
    const sensitivity = typeof item.sensitivity === "number" && Number.isFinite(item.sensitivity) ? Math.min(100, Math.max(10, Math.round(item.sensitivity))) : 70
    zones.push({
      id,
      name: (typeof item.name === "string" ? item.name.trim() : "").slice(0, 40) || "未命名围栏",
      type,
      coordinates,
      color: severity === "critical" ? "var(--destructive)" : "var(--warning)",
      severity,
      enabled: item.enabled !== false,
      cameraId: typeof item.cameraId === "string" ? item.cameraId.trim().slice(0, 80) : "",
      targets: targets.length > 0 ? targets : ["person"],
      action,
      sensitivity,
      directional: type === "tripwire" ? item.directional === true : false,
      custom: true,
    })
    if (zones.length >= MAX_ZONES) break
  }
  return zones.filter((zone) => zone.cameraId)
}

export function loadZones(): RoiZone[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(roiZonesPath(), "utf8")) as { zones?: unknown }
    return sanitizeZones(parsed.zones)
  } catch {
    return []
  }
}

/** 原子写：临时文件 + rename。 */
export function saveZones(zones: RoiZone[]) {
  const file = roiZonesPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), zones }, null, 2), "utf8")
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}
