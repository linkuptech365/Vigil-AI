import type {
  ClipReason,
  ClipStatus,
  EntityScript,
  EscalationClip,
  PerceptionMetrics,
  RoiAction,
  RoiZone,
  SeriesPoint,
  TrackClass,
} from "./perception-types"

export const RED_ZONE_ID = "Z-RED"
export const VIOLATOR_ID = "T-115"

export const INTRUSION_PATH: [number, number][] = [
  [79, 88],
  [64, 87],
  [79, 88],
]

export const SCENES: Record<string, EntityScript[]> = {
  "CAM-01": [
    {
      id: "T-301",
      trackId: 301,
      class: "vehicle",
      label: "Truck",
      size: [16, 34],
      path: [
        [45, 46],
        [44, 64],
      ],
      speed: 1.6,
      confidence: 95,
      startDist: 2,
    },
    {
      id: "T-302",
      trackId: 302,
      class: "person",
      label: "Person",
      size: [7, 40],
      path: [
        [70, 84],
        [74, 95],
      ],
      speed: 1.3,
      confidence: 97,
    },
    {
      id: "T-303",
      trackId: 303,
      class: "person",
      label: "Person",
      size: [8.5, 42],
      path: [
        [81, 86],
        [85, 96],
      ],
      speed: 1.1,
      confidence: 96,
      startDist: 3,
    },
  ],
  "CAM-02": [
    {
      id: "T-104",
      trackId: 104,
      class: "person",
      label: "Person",
      size: [7.5, 30],
      path: [
        [22, 80],
        [30, 84],
        [36, 82],
      ],
      speed: 2.2,
      confidence: 94,
      startDist: 3,
    },
    {
      id: "T-208",
      trackId: 208,
      class: "forklift",
      label: "Forklift",
      size: [15, 22],
      path: [
        [20, 93],
        [52, 93],
      ],
      speed: 3.5,
      confidence: 98,
      startDist: 12,
    },
    {
      id: VIOLATOR_ID,
      trackId: 115,
      class: "person",
      label: "Worker (No Vest)",
      size: [8, 34],
      path: [
        [79, 88],
        [84, 90],
      ],
      speed: 1.2,
      confidence: 91,
      isViolating: true,
    },
  ],
  "CAM-03": [
    {
      id: "T-401",
      trackId: 401,
      class: "person",
      label: "Person",
      size: [4.5, 11],
      path: [
        [22, 68],
        [34, 74],
      ],
      speed: 1.5,
      confidence: 93,
    },
    {
      id: "T-402",
      trackId: 402,
      class: "vehicle",
      label: "Pickup",
      size: [11, 11],
      path: [
        [85, 66],
        [91, 68],
      ],
      speed: 0.8,
      confidence: 96,
    },
  ],
  "CAM-04": [
    {
      id: "T-501",
      trackId: 501,
      class: "forklift",
      label: "Forklift",
      size: [18, 37],
      path: [
        [42, 80],
        [45, 94],
      ],
      speed: 1.2,
      confidence: 98,
    },
    {
      id: "T-502",
      trackId: 502,
      class: "person",
      label: "Person",
      size: [6, 26],
      path: [
        [70, 84],
        [71, 85],
      ],
      speed: 0.3,
      confidence: 92,
    },
    {
      id: "T-503",
      trackId: 503,
      class: "person",
      label: "Person",
      size: [6, 26],
      path: [
        [75, 79],
        [76, 80],
      ],
      speed: 0.25,
      confidence: 90,
    },
    {
      id: "T-504",
      trackId: 504,
      class: "person",
      label: "Person",
      size: [6, 28],
      path: [
        [81, 85],
        [82, 86],
      ],
      speed: 0.35,
      confidence: 93,
    },
    {
      id: "T-505",
      trackId: 505,
      class: "person",
      label: "Person",
      size: [6, 28],
      path: [
        [86, 88],
        [87, 89],
      ],
      speed: 0.3,
      confidence: 91,
    },
  ],
}

const PERSON: TrackClass[] = ["person"]

export const INITIAL_ZONES: RoiZone[] = [
  {
    id: RED_ZONE_ID,
    name: "1号机加工红线禁区 (Hazard Red Zone)",
    type: "polygon",
    coordinates: [
      [56, 73],
      [72, 71],
      [76, 95],
      [55, 95],
    ],
    color: "var(--destructive)",
    severity: "critical",
    enabled: true,
    cameraId: "CAM-02",
    targets: PERSON,
    action: "escalate",
    sensitivity: 70,
  },
  {
    id: "Z-PERIM",
    name: "西侧周界电子围栏 (Perimeter Fence)",
    type: "tripwire",
    coordinates: [
      [10, 42],
      [10, 98],
    ],
    color: "var(--warning)",
    severity: "warning",
    enabled: true,
    cameraId: "CAM-02",
    targets: PERSON,
    action: "siren",
    sensitivity: 55,
    directional: false,
  },
  {
    id: "Z-FORK",
    name: "叉车单向通行绊线 (One-way Tripwire)",
    type: "tripwire",
    coordinates: [
      [44, 78],
      [44, 98],
    ],
    color: "var(--signal)",
    severity: "warning",
    enabled: true,
    cameraId: "CAM-02",
    targets: ["forklift"],
    action: "log",
    sensitivity: 60,
    directional: true,
  },
  {
    id: "Z-GATE",
    name: "出口车道逆行绊线 (Contra-flow Tripwire)",
    type: "tripwire",
    coordinates: [
      [35, 55],
      [58, 55],
    ],
    color: "var(--signal)",
    severity: "warning",
    enabled: true,
    cameraId: "CAM-01",
    targets: ["vehicle"],
    action: "log",
    sensitivity: 60,
    directional: true,
  },
  {
    id: "Z-TANK",
    name: "储罐防爆隔离区 (Tank Containment Zone)",
    type: "polygon",
    coordinates: [
      [36, 58],
      [66, 60],
      [66, 67],
      [36, 66],
    ],
    color: "var(--destructive)",
    severity: "critical",
    enabled: true,
    cameraId: "CAM-03",
    targets: PERSON,
    action: "escalate",
    sensitivity: 75,
  },
  {
    id: "Z-LANE",
    name: "叉车通行道禁入区 (Forklift Lane)",
    type: "polygon",
    coordinates: [
      [27, 84],
      [44, 84],
      [43, 100],
      [26, 100],
    ],
    color: "var(--warning)",
    severity: "warning",
    enabled: true,
    cameraId: "CAM-04",
    targets: PERSON,
    action: "log",
    sensitivity: 50,
  },
]

export const REASON_LABEL: Record<ClipReason, string> = {
  roi_breach: "ROI越界",
  fall_suspect: "剧烈位移/摔倒疑似",
  crowd_anomaly: "聚集异常",
}

export const STATUS_LABEL: Record<ClipStatus, string> = {
  sent: "已送往大模型",
  queued: "排队中",
  blocked: "已拦截",
}

export const ACTION_LABEL: Record<RoiAction, string> = {
  escalate: "送大模型深度研判",
  log: "仅记录日志",
  siren: "声光报警并送检",
}

export const INITIAL_CLIPS: EscalationClip[] = [
  { id: "CLP-0409", cameraId: "CAM-02", reason: "roi_breach", confidence: 96, status: "sent", edgeMs: 14, time: "14:21:07" },
  { id: "CLP-0408", cameraId: "CAM-04", reason: "crowd_anomaly", confidence: 88, status: "sent", edgeMs: 16, time: "14:19:42" },
  { id: "CLP-0407", cameraId: "CAM-02", reason: "fall_suspect", confidence: 82, status: "sent", edgeMs: 13, time: "14:17:30" },
  { id: "CLP-0406", cameraId: "CAM-01", reason: "fall_suspect", confidence: 71, status: "blocked", edgeMs: 12, time: "14:15:12" },
  { id: "CLP-0405", cameraId: "CAM-03", reason: "roi_breach", confidence: 91, status: "sent", edgeMs: 15, time: "14:12:58" },
  { id: "CLP-0404", cameraId: "CAM-04", reason: "crowd_anomaly", confidence: 74, status: "blocked", edgeMs: 11, time: "14:10:33" },
  { id: "CLP-0403", cameraId: "CAM-02", reason: "roi_breach", confidence: 93, status: "sent", edgeMs: 14, time: "14:08:09" },
]

export const AUTO_CLIP_TEMPLATES: { cameraId: string; reason: ClipReason; confidence: number }[] = [
  { cameraId: "CAM-04", reason: "crowd_anomaly", confidence: 86 },
  { cameraId: "CAM-02", reason: "fall_suspect", confidence: 80 },
  { cameraId: "CAM-01", reason: "fall_suspect", confidence: 72 },
  { cameraId: "CAM-03", reason: "roi_breach", confidence: 89 },
  { cameraId: "CAM-04", reason: "crowd_anomaly", confidence: 78 },
]

export const INITIAL_METRICS: PerceptionMetrics = {
  ingested: 124_800,
  escalatedFrames: 14_476,
  clips: 18,
}

export const ESCALATION_RATIO = 14_476 / 124_800
export const DAILY_SAVING_USD = 412
export const BASE_FILTER_RATE = 88.4

/** Deterministic 30-minute history so server and client render identically. */
export const INITIAL_SERIES: SeriesPoint[] = Array.from({ length: 30 }, (_, i) => {
  const ingested = Math.round(4160 * (1 + 0.11 * Math.sin(i * 1.7) + 0.05 * Math.cos(i * 0.9)))
  const escalated = Math.round(ingested * ESCALATION_RATIO * (1 + 0.18 * Math.sin(i * 0.8 + 1)))
  return { ingested, escalated }
})
