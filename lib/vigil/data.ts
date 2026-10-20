import type { Settings, Truth, VideoItem } from "./types"

export const DEMO_FOLDER = "/data/videos/surveillance_stream"

export const DEFAULT_FOLDER = "./sample-videos"

export const FOLDER_CHIPS = [
  DEFAULT_FOLDER,
  "./public",
  "./",
  "/tmp",
  DEMO_FOLDER,
  "/mnt/nas/cctv_archive/gate_east",
]

export const VIDEO_FORMATS = [".mp4", ".avi", ".mkv", ".mov", ".webm", ".flv"]

export interface ApiPreset {
  id: string
  label: string
  url: string
  model: string
}

export const API_PRESETS: ApiPreset[] = [
  {
    id: "fastapi",
    label: "FastAPI Local",
    url: "http://localhost:8000/api/v1/analyze",
    model: "Qwen2.5-VL",
  },
  {
    id: "ollama",
    label: "Ollama Instance",
    url: "http://localhost:11434/api/chat",
    model: "qwen2.5vl:7b",
  },
  {
    id: "openai",
    label: "OpenAI Compatible",
    url: "https://api.example.com/v1/chat/completions",
    model: "qwen2.5-vl-72b-instruct",
  },
  {
    id: "qwen",
    label: "Qwen-VL Gateway",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    model: "qwen-vl-max",
  },
]

export const DEFAULT_SETTINGS: Settings = {
  apiUrl: API_PRESETS[0].url,
  presetId: "fastapi",
  samplingFps: 2,
  threshold: 0.8,
  rules: {
    violence: true,
    ppe: true,
    fire: true,
    intrusion: true,
    gmpEsd: true,
    gmpTransfer: true,
    gmpClassA: true,
  },
  folderPath: DEFAULT_FOLDER,
  recursive: true,
  formats: [...VIDEO_FORMATS],
}

type VideoSeed = Omit<VideoItem, "id" | "status" | "path"> & { dir: string }

function today(time: string) {
  return `2026-10-20 ${time}`
}

const SEEDS: Record<string, VideoSeed> = {
  gateFight: {
    name: "gate_east_cam01_20261020_081530.mp4",
    dir: "gate_east",
    durationSec: 15,
    sizeMB: 12.4,
    fps: 25,
    recordedAt: today("08:15:30"),
    truth: { ruleId: "violence", confidence: 0.94 },
  },
  machining: {
    name: "machining_zone_cam07_20261020_094212.mp4",
    dir: "workshop_a",
    durationSec: 28,
    sizeMB: 23.8,
    fps: 25,
    recordedAt: today("09:42:12"),
    truth: { ruleId: "ppe", confidence: 0.91 },
  },
  parking: {
    name: "parking_north_cam03_20261020_110005.mp4",
    dir: "parking_north",
    durationSec: 20,
    sizeMB: 16.1,
    fps: 30,
    recordedAt: today("11:00:05"),
    truth: { ruleId: null, confidence: 0.97 },
  },
  warehouseSmoke: {
    name: "warehouse_c_cam11_20261020_142347.mkv",
    dir: "warehouse_c",
    durationSec: 24,
    sizeMB: 31.2,
    fps: 25,
    recordedAt: today("14:23:47"),
    truth: { ruleId: "fire", confidence: 0.89 },
  },
  perimeter: {
    name: "perimeter_west_cam05_20261020_023318.avi",
    dir: "perimeter_west",
    durationSec: 18,
    sizeMB: 14.6,
    fps: 15,
    recordedAt: today("02:33:18"),
    truth: { ruleId: "intrusion", confidence: 0.96 },
  },
  lobby: {
    name: "lobby_main_cam02_20261020_131500.mov",
    dir: "lobby_main",
    durationSec: 32,
    sizeMB: 27.5,
    fps: 30,
    recordedAt: today("13:15:00"),
    truth: { ruleId: null, confidence: 0.98 },
  },
  canteenFight: {
    name: "canteen_cam04_20261020_121840.mp4",
    dir: "canteen",
    durationSec: 12,
    sizeMB: 9.7,
    fps: 25,
    recordedAt: today("12:18:40"),
    truth: { ruleId: "violence", confidence: 0.87 },
  },
  siteHelmet: {
    name: "construction_site_cam09_20261020_100730.mp4",
    dir: "construction_site",
    durationSec: 26,
    sizeMB: 21.3,
    fps: 25,
    recordedAt: today("10:07:30"),
    truth: { ruleId: "ppe", confidence: 0.93 },
  },
  dock: {
    name: "loading_dock_cam06_20261020_153010.mp4",
    dir: "loading_dock",
    durationSec: 22,
    sizeMB: 18.2,
    fps: 25,
    recordedAt: today("15:30:10"),
    truth: { ruleId: null, confidence: 0.96 },
  },
}

let counter = 0

function joinPath(base: string, ...parts: string[]) {
  const sep = base.includes("\\") ? "\\" : "/"
  const trimmed = base.replace(/[\\/]+$/, "")
  return [trimmed, ...parts].join(sep)
}

function fromSeed(seed: VideoSeed, folder: string, nested: boolean): VideoItem {
  counter += 1
  const { dir, ...rest } = seed
  return {
    ...rest,
    id: `vid-${Date.now().toString(36)}-${counter}`,
    path: nested ? joinPath(folder, dir, seed.name) : joinPath(folder, seed.name),
    status: "pending",
  }
}

export function createInitialQueue(): VideoItem[] {
  return [SEEDS.gateFight, SEEDS.machining, SEEDS.parking].map((seed) => {
    const { dir, ...rest } = seed
    return {
      ...rest,
      id: `seed-${seed.name}`,
      path: joinPath(DEMO_FOLDER, dir, seed.name),
      status: "pending" as const,
    }
  })
}

const INJECT_ORDER = [
  SEEDS.warehouseSmoke,
  SEEDS.perimeter,
  SEEDS.lobby,
  SEEDS.canteenFight,
  SEEDS.siteHelmet,
  SEEDS.dock,
]

let injectCursor = 0

export function createTestSamples(count = 3): VideoItem[] {
  const out: VideoItem[] = []
  for (let i = 0; i < count; i += 1) {
    const seed = INJECT_ORDER[injectCursor % INJECT_ORDER.length]
    injectCursor += 1
    out.push(fromSeed(seed, "/data/videos/test_samples", false))
  }
  return out
}

export function hashString(value: string) {
  let h = 0
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0
  }
  return h
}

const LOCAL_TRUTHS: Truth[] = [
  { ruleId: null, confidence: 0.97 },
  { ruleId: "violence", confidence: 0.92 },
  { ruleId: null, confidence: 0.95 },
  { ruleId: "ppe", confidence: 0.9 },
  { ruleId: "intrusion", confidence: 0.94 },
  { ruleId: "fire", confidence: 0.88 },
]

const GMP_TRUTHS: Record<string, Truth> = {
  "case_bio_01_esd_shoes_violation.mp4": { ruleId: "gmpEsd", confidence: 0.93 },
  "case_bio_02_aseptic_transfer_collision.mp4": { ruleId: "gmpTransfer", confidence: 0.95 },
  "case_bio_03_class_a_zone_touch.mp4": { ruleId: "gmpClassA", confidence: 0.97 },
  "case_bio_04_standard_gmp_operation.mp4": { ruleId: null, confidence: 0.99 },
}

export function truthForLocalFile(name: string): Truth {
  const gmp = GMP_TRUTHS[name]
  if (gmp) return gmp
  return LOCAL_TRUTHS[hashString(name) % LOCAL_TRUTHS.length]
}

export function formatDuration(totalSec: number) {
  const m = Math.floor(totalSec / 60)
  const s = Math.round(totalSec % 60)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function formatSize(mb: number) {
  return `${mb.toFixed(1)} MB`
}

export function shortFolder(path: string) {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  if (parts.length <= 1) return path
  return `.../${parts[parts.length - 1]}`
}
