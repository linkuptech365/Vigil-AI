"""Vigil-AI 本地视觉初筛守护服务（vision-worker）。

三级漏斗中的前两级都在这里完成，对外只监听 127.0.0.1:1985，由 Node 主服务统一代理：

  Tier-0  OpenCV 帧差：画面静止则直接丢弃，不唤醒模型（纯 CPU，毫秒级）
  Tier-1  YOLO-World 开放词汇检测 + ByteTrack 轨迹：三阶门控 + 连续命中防抖 + 冷却锁
  Tier-2  触发后把关键帧与带框快照推给 Node 的 /api/v1/incident/trigger，由云端大模型终审

PyTorch / ultralytics 缺失、权重未下载或 CLIP 文本编码器不可用时，服务仍会正常启动并进入
degraded (motion-only) 模式：只做 Tier-0 帧差并如实回报原因，绝不影响主项目。
"""

from __future__ import annotations

import base64
import os
import sys
import threading
import time
import uuid
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import httpx
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

HOST = "127.0.0.1"
PORT = int(os.environ.get("VIGIL_VISION_PORT", "1985"))
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = Path(os.environ.get("VIGIL_MODELS_DIR") or PROJECT_ROOT / "models")
WEIGHTS_PATH = MODELS_DIR / "yolov8s-worldv2.pt"
EDGE_TOKEN = os.environ.get("VIGIL_EDGE_TOKEN", "").strip()

ROLE_ANCHOR = "anchor_person"
ROLE_PPE = "required_ppe"
ROLE_HAZARD = "hazard_target"
ROLES = (ROLE_ANCHOR, ROLE_PPE, ROLE_HAZARD)

ROLE_COLORS = {  # BGR
    ROLE_ANCHOR: (255, 140, 30),
    ROLE_PPE: (90, 200, 80),
    ROLE_HAZARD: (60, 60, 235),
}

RING_SIZE = 5
FRESH_SECONDS = 2.5
MAX_EVENTS = 30


# --------------------------------------------------------------------------- #
# 配置与全局状态
# --------------------------------------------------------------------------- #
class VocabItem(BaseModel):
    id: str = ""
    labelZh: str = ""
    promptEn: str
    role: str = ROLE_HAZARD
    enabled: bool = True


class ReloadRequest(BaseModel):
    enabled: bool = True
    sampleFps: float = 2.0
    motionThresholdPct: float = 1.5
    confidenceLow: float = 0.40
    confidenceHigh: float = 0.85
    minConsecutiveFrames: int = 3
    cooldownSeconds: float = 30.0
    staticRecheckSec: float = 10.0
    vocabulary: list[VocabItem] = Field(default_factory=list)
    streamIds: list[str] = Field(default_factory=list)
    go2rtcUrl: str = "http://127.0.0.1:1984"
    triggerUrl: str = ""


@dataclass
class Config:
    enabled: bool = True
    sample_fps: float = 2.0
    motion_pct: float = 1.5
    low: float = 0.40
    high: float = 0.85
    min_frames: int = 3
    cooldown: float = 30.0
    static_recheck: float = 10.0
    stream_ids: list[str] = field(default_factory=list)
    go2rtc: str = "http://127.0.0.1:1984"
    trigger_url: str = ""


@dataclass
class Det:
    prompt: str
    role: str
    conf: float
    box: tuple[float, float, float, float]
    track_id: int | None = None


@dataclass
class Suspect:
    key: str
    track_id: int | None
    conf: float
    reasons: list[str]


@dataclass
class TrackState:
    hits: int
    last_conf: float
    reasons: list[str]


@dataclass
class StreamState:
    sid: str
    tracker: Any = None
    preview_tracker: Any = None
    prev_gray: np.ndarray | None = None
    preview_gray: np.ndarray | None = None
    ring: deque = field(default_factory=lambda: deque(maxlen=RING_SIZE))
    tracks: dict[str, TrackState] = field(default_factory=dict)
    cooldown: dict[str, float] = field(default_factory=dict)
    next_at: float = 0.0
    last_infer_ts: float = 0.0
    last_had_person: bool = False
    has_pending: bool = False
    last_error: str = ""
    last_ok_ts: float = 0.0
    last_motion_pct: float | None = None
    last_persons: int = 0
    last: dict[str, Any] | None = None
    frames: int = 0


class Stats:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.total_frames = 0
        self.tier0_filtered = 0
        self.tier1_inferred = 0
        self.tier1_passed = 0
        self.tier1_pending = 0
        self.tier2_triggered = 0
        self.cooldown_suppressed = 0
        self.motion_only = 0
        self.tier2_confirmed = 0
        self.tier2_rejected = 0
        self.tier2_failed = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "totalFrames": self.total_frames,
            "tier0Filtered": self.tier0_filtered,
            "tier1Inferred": self.tier1_inferred,
            "tier1Passed": self.tier1_passed,
            "tier1Pending": self.tier1_pending,
            "tier2Triggered": self.tier2_triggered,
            "cooldownSuppressed": self.cooldown_suppressed,
            "motionOnlyFrames": self.motion_only,
            "tier2Confirmed": self.tier2_confirmed,
            "tier2Rejected": self.tier2_rejected,
            "tier2Failed": self.tier2_failed,
        }


class Runtime:
    def __init__(self) -> None:
        self.cfg = Config()
        self.stats = Stats()
        self.started_at = time.time()
        self.device = "cpu"
        self.model: Any = None
        self.model_state = "loading"  # loading | ready | degraded
        self.reason = "正在加载 YOLO-World 模型…"
        self.versions: dict[str, str] = {"python": sys.version.split()[0], "opencv": cv2.__version__}
        self.classes_applied: list[str] = []
        self.pending_prompts: list[str] = []
        self.role_map: dict[str, str] = {}
        self.label_map: dict[str, str] = {}
        self.vocab: list[VocabItem] = []
        self.streams: dict[str, StreamState] = {}
        self.events: deque = deque(maxlen=MAX_EVENTS)
        self.tracker_kind = "bytetrack"
        self.last_reload_ms = 0.0
        self.model_lock = threading.RLock()
        self.cfg_lock = threading.RLock()


RT = Runtime()
STOP = threading.Event()
HTTP = httpx.Client(timeout=httpx.Timeout(10.0, connect=3.0))
PUSH_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="tier2-push")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    print(f"[vision-worker] {message}", flush=True)


# --------------------------------------------------------------------------- #
# 轨迹器：优先 supervision.ByteTrack，不可用时降级为 IoU 贪心匹配
# --------------------------------------------------------------------------- #
def iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0:
        return 0.0
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


class IouTracker:
    def __init__(self, max_miss: int = 10, threshold: float = 0.3) -> None:
        self.tracks: list[dict[str, Any]] = []
        self.next_id = 1
        self.max_miss = max_miss
        self.threshold = threshold

    def update(self, boxes: list[tuple[float, float, float, float]], confs: list[float]) -> list[int | None]:
        ids: list[int | None] = [None] * len(boxes)
        taken: set[int] = set()
        pairs = sorted(
            ((iou(t["box"], b), ti, bi) for ti, t in enumerate(self.tracks) for bi, b in enumerate(boxes)),
            reverse=True,
        )
        used_boxes: set[int] = set()
        for score, ti, bi in pairs:
            if score < self.threshold:
                break
            if ti in taken or bi in used_boxes:
                continue
            taken.add(ti)
            used_boxes.add(bi)
            self.tracks[ti]["box"] = boxes[bi]
            self.tracks[ti]["miss"] = 0
            ids[bi] = self.tracks[ti]["id"]
        for ti, t in enumerate(self.tracks):
            if ti not in taken:
                t["miss"] += 1
        self.tracks = [t for t in self.tracks if t["miss"] <= self.max_miss]
        for bi, box in enumerate(boxes):
            if bi in used_boxes:
                continue
            self.tracks.append({"id": self.next_id, "box": box, "miss": 0})
            ids[bi] = self.next_id
            self.next_id += 1
        return ids


class ByteTrackAdapter:
    def __init__(self, sv: Any) -> None:
        self.sv = sv
        try:
            self.tracker = sv.ByteTrack(
                track_activation_threshold=0.3,
                lost_track_buffer=30,
                minimum_matching_threshold=0.5,
                frame_rate=30,
            )
        except TypeError:
            self.tracker = sv.ByteTrack()

    def update(self, boxes: list[tuple[float, float, float, float]], confs: list[float]) -> list[int | None]:
        sv = self.sv
        if boxes:
            detections = sv.Detections(
                xyxy=np.array(boxes, dtype=np.float32),
                confidence=np.array(confs, dtype=np.float32),
                class_id=np.zeros(len(boxes), dtype=int),
            )
        else:
            detections = sv.Detections.empty()
        tracked = self.tracker.update_with_detections(detections)
        ids: list[int | None] = [None] * len(boxes)
        if tracked.tracker_id is None:
            return ids
        for k in range(len(tracked)):
            out = tuple(float(v) for v in tracked.xyxy[k])
            best, best_iou = -1, 0.0
            for bi, box in enumerate(boxes):
                score = iou(out, box)  # type: ignore[arg-type]
                if score > best_iou:
                    best, best_iou = bi, score
            if best >= 0 and best_iou > 0.1 and ids[best] is None:
                ids[best] = int(tracked.tracker_id[k])
        return ids


def make_tracker() -> Any:
    try:
        import supervision as sv

        if hasattr(sv, "ByteTrack"):
            RT.versions["supervision"] = getattr(sv, "__version__", "unknown")
            RT.tracker_kind = "bytetrack"
            return ByteTrackAdapter(sv)
    except Exception as error:  # noqa: BLE001
        log(f"supervision.ByteTrack 不可用，改用 IoU 轨迹器：{error}")
    RT.tracker_kind = "iou-fallback"
    return IouTracker()


def stream_state(sid: str) -> StreamState:
    with RT.cfg_lock:
        st = RT.streams.get(sid)
        if st is None:
            st = StreamState(sid=sid)
            RT.streams[sid] = st
        return st


# --------------------------------------------------------------------------- #
# 模型加载与词表热更新
# --------------------------------------------------------------------------- #
def detect_device() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        mps = getattr(torch.backends, "mps", None)
        if mps is not None and mps.is_available():
            return "mps"
    except Exception:  # noqa: BLE001
        pass
    return "cpu"


def degrade(reason: str) -> None:
    RT.model_state = "degraded"
    RT.reason = reason
    log(f"进入 degraded (motion-only) 模式：{reason}")


def apply_classes(prompts: list[str]) -> tuple[bool, str]:
    """把词表写入 YOLO-World（内存热切换，不重启进程，也不重置 ByteTrack 轨迹）。"""
    if RT.model is None:
        RT.pending_prompts = prompts
        return False, RT.reason
    if not prompts:
        RT.classes_applied = []
        return True, "词表为空，已暂停 Tier-1 推理"
    if prompts == RT.classes_applied and RT.model_state == "ready":
        return True, "词表未变化"
    try:
        with RT.model_lock:
            RT.model.set_classes(prompts)
        RT.classes_applied = list(prompts)
        RT.model_state = "ready"
        RT.reason = ""
        return True, f"已注入 {len(prompts)} 个词条"
    except Exception as error:  # noqa: BLE001
        text = str(error)
        hint = "CLIP 文本编码器不可用（需要 git 与网络下载 CLIP 依赖及文本权重），请重新运行 npm run setup:vision" if "clip" in text.lower() else text[:200]
        degrade(f"词表注入失败：{hint}")
        return False, RT.reason


def load_model() -> None:
    RT.device = detect_device()
    try:
        import ultralytics
        from ultralytics import YOLOWorld

        RT.versions["ultralytics"] = ultralytics.__version__
    except Exception as error:  # noqa: BLE001
        degrade(f"未安装 PyTorch / ultralytics（{type(error).__name__}），请运行 npm run setup:vision 完成视觉依赖安装")
        return
    try:
        import torch

        RT.versions["torch"] = torch.__version__
    except Exception:  # noqa: BLE001
        pass
    if not WEIGHTS_PATH.exists():
        degrade(f"未找到模型权重 {WEIGHTS_PATH}，请运行 npm run setup:vision 下载 yolov8s-worldv2.pt")
        return
    try:
        started = time.perf_counter()
        model = YOLOWorld(str(WEIGHTS_PATH))
        try:
            model.to(RT.device)
        except Exception as error:  # noqa: BLE001
            log(f"迁移到 {RT.device} 失败，回退 CPU：{error}")
            RT.device = "cpu"
        RT.model = model
        log(f"YOLO-World 权重加载完成（{time.perf_counter() - started:.1f}s，设备 {RT.device}）")
    except Exception as error:  # noqa: BLE001
        degrade(f"模型权重加载失败：{str(error)[:200]}")
        return
    with RT.cfg_lock:
        prompts = list(RT.pending_prompts)
    if prompts:
        apply_classes(prompts)
    else:
        RT.model_state = "ready"
        RT.reason = ""


# --------------------------------------------------------------------------- #
# 取帧、Tier-0 帧差
# --------------------------------------------------------------------------- #
def fetch_frame(sid: str) -> tuple[bytes, np.ndarray]:
    url = f"{RT.cfg.go2rtc}/api/frame.jpeg"
    response = HTTP.get(url, params={"src": sid, "width": 960}, timeout=httpx.Timeout(15.0, connect=3.0))
    if response.status_code != 200:
        raise RuntimeError(f"流媒体引擎返回 HTTP {response.status_code}")
    data = response.content
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError("引擎返回的不是有效的 JPEG 画面")
    return data, image


def motion_ratio(prev: np.ndarray | None, image: np.ndarray) -> tuple[float | None, np.ndarray, np.ndarray | None]:
    """高斯模糊 + cv2.absdiff，返回变化像素占比（%）、当前灰度图与变化掩膜。"""
    height = max(1, int(image.shape[0] * 320 / image.shape[1]))
    small = cv2.resize(image, (320, height), interpolation=cv2.INTER_AREA)
    gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (9, 9), 0)
    if prev is None or prev.shape != gray.shape:
        return None, gray, None
    diff = cv2.absdiff(prev, gray)
    _, mask = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
    mask = cv2.dilate(mask, None, iterations=2)
    return float(cv2.countNonZero(mask)) / mask.size * 100.0, gray, mask


# --------------------------------------------------------------------------- #
# Tier-1：检测、门控
# --------------------------------------------------------------------------- #
def detect(image: np.ndarray, tracker: Any) -> list[Det]:
    low = RT.cfg.low
    conf_floor = max(0.05, min(0.25, low))
    with RT.model_lock:
        result = RT.model.predict(image, conf=conf_floor, imgsz=640, device=RT.device, verbose=False)[0]
    names = result.names
    dets: list[Det] = []
    boxes = result.boxes
    if boxes is not None and len(boxes) > 0:
        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        classes = boxes.cls.cpu().numpy().astype(int)
        for k in range(len(boxes)):
            prompt = str(names.get(int(classes[k]), ""))
            role = RT.role_map.get(prompt)
            if role is None:
                continue
            x1, y1, x2, y2 = (float(v) for v in xyxy[k])
            dets.append(Det(prompt=prompt, role=role, conf=float(confs[k]), box=(x1, y1, x2, y2)))
    persons = [d for d in dets if d.role == ROLE_ANCHOR]
    ids = tracker.update([d.box for d in persons], [d.conf for d in persons])
    for d, track_id in zip(persons, ids):
        d.track_id = track_id
    return dets


def inside(inner: Det, outer: Det) -> bool:
    cx = (inner.box[0] + inner.box[2]) / 2
    cy = (inner.box[1] + inner.box[3]) / 2
    x1, y1, x2, y2 = outer.box
    pad_x, pad_y = (x2 - x1) * 0.08, (y2 - y1) * 0.05
    return x1 - pad_x <= cx <= x2 + pad_x and y1 - pad_y <= cy <= y2 + pad_y


def label_of(prompt: str) -> str:
    return RT.label_map.get(prompt) or prompt


def evaluate(dets: list[Det]) -> tuple[list[Suspect], int, int]:
    """三阶门控：返回（疑似目标列表, 合规放行人数, 画面中人数）。"""
    low, high = RT.cfg.low, RT.cfg.high
    required = [p for p, r in RT.role_map.items() if r == ROLE_PPE and p in RT.classes_applied]
    persons = [d for d in dets if d.role == ROLE_ANCHOR and d.conf >= low]
    ppe = [d for d in dets if d.role == ROLE_PPE and d.conf >= low]
    hazards = [d for d in dets if d.role == ROLE_HAZARD and d.conf >= low]
    used: set[int] = set()
    suspects: list[Suspect] = []
    passed = 0
    for index, person in enumerate(persons):
        key = f"t{person.track_id}" if person.track_id is not None else f"p{index}"
        reasons: list[str] = []
        confs = [person.conf]
        suspect_conf = 0.0
        for prompt in required:
            hit = [d for d in ppe if d.prompt == prompt and inside(d, person)]
            if hit:
                confs.append(max(d.conf for d in hit))
            else:
                reasons.append(f"缺失必需劳保：{label_of(prompt)}")
                suspect_conf = max(suspect_conf, person.conf)
        for hid, hazard in enumerate(hazards):
            if inside(hazard, person) or iou(hazard.box, person.box) > 0:
                reasons.append(f"命中违规目标：{label_of(hazard.prompt)}（{hazard.conf:.2f}）")
                suspect_conf = max(suspect_conf, hazard.conf)
                used.add(hid)
        if not reasons and min(confs) < high:
            reasons.append(f"置信度处于模糊区间（{min(confs):.2f} < {high:.2f}）")
            suspect_conf = min(confs)
        if reasons:
            suspects.append(Suspect(key=key, track_id=person.track_id, conf=round(suspect_conf, 3), reasons=reasons))
        else:
            passed += 1
    for hid, hazard in enumerate(hazards):
        if hid in used:
            continue
        suspects.append(
            Suspect(
                key=f"scene:{hazard.prompt}",
                track_id=None,
                conf=round(hazard.conf, 3),
                reasons=[f"画面中检出违规目标：{label_of(hazard.prompt)}（{hazard.conf:.2f}）"],
            )
        )
    return suspects, passed, len(persons)


# --------------------------------------------------------------------------- #
# 标注图
# --------------------------------------------------------------------------- #
def draw(image: np.ndarray, dets: list[Det], header: str, mask: np.ndarray | None = None, warn: bool = False) -> np.ndarray:
    canvas = image.copy()
    height, width = canvas.shape[:2]
    if mask is not None:
        scaled = cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST)
        contours, _ = cv2.findContours(scaled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            if cv2.contourArea(contour) < width * height * 0.002:
                continue
            x, y, w, h = cv2.boundingRect(contour)
            cv2.rectangle(canvas, (x, y), (x + w, y + h), (0, 190, 255), 2)
    for det in dets:
        color = ROLE_COLORS.get(det.role, (200, 200, 200))
        x1, y1, x2, y2 = (int(v) for v in det.box)
        cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 2)
        tag = f"#{det.track_id} " if det.track_id is not None else ""
        text = f"{tag}{det.prompt} {det.conf:.2f}"
        (tw, th), base = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        top = max(0, y1 - th - base - 4)
        cv2.rectangle(canvas, (x1, top), (x1 + tw + 6, top + th + base + 4), color, -1)
        cv2.putText(canvas, text, (x1 + 3, top + th + 2), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    cv2.rectangle(canvas, (0, 0), (width, 24), (20, 20, 20), -1)
    cv2.putText(canvas, header, (8, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 190, 255) if warn else (120, 220, 120), 1, cv2.LINE_AA)
    return canvas


def encode_jpeg(image: np.ndarray, quality: int = 82) -> bytes:
    ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("JPEG 编码失败")
    return buffer.tobytes()


def header_text(motion: float | None, dets: list[Det]) -> str:
    persons = sum(1 for d in dets if d.role == ROLE_ANCHOR)
    motion_text = "n/a" if motion is None else f"{motion:.1f}%"
    if RT.model_state != "ready":
        return f"DEGRADED motion-only | motion {motion_text} | {RT.device}"
    return f"Tier-1 YOLO-World+{RT.tracker_kind} | motion {motion_text} | persons {persons} | {RT.device}"


# --------------------------------------------------------------------------- #
# Tier-2 推送
# --------------------------------------------------------------------------- #
def push_event(event: dict[str, Any], frames: list[str]) -> None:
    url = RT.cfg.trigger_url
    if not url:
        event["status"] = "error"
        event["summary"] = "未配置 triggerUrl，无法送审"
        RT.stats.tier2_failed += 1
        return
    headers = {"Authorization": f"Bearer {EDGE_TOKEN}"} if EDGE_TOKEN else {}
    body = {
        "streamId": event["streamId"],
        "trackId": event["trackId"],
        "edgeConfidence": event["confidence"],
        "label": event["label"],
        "keyframesBase64": frames,
    }
    try:
        response = httpx.post(url, json=body, headers=headers, timeout=httpx.Timeout(170.0, connect=5.0))
        payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
        if response.status_code != 200:
            event["status"] = "error"
            event["summary"] = str(payload.get("message") or f"HTTP {response.status_code}")[:200]
            RT.stats.tier2_failed += 1
            return
        confirmed = payload.get("verdict") == "confirmed"
        event["status"] = "confirmed" if confirmed else "rejected"
        event["summary"] = str(payload.get("summary") or "")[:300]
        event["alertId"] = payload.get("alertId")
        if confirmed:
            RT.stats.tier2_confirmed += 1
        else:
            RT.stats.tier2_rejected += 1
    except Exception as error:  # noqa: BLE001
        event["status"] = "error"
        event["summary"] = f"送审失败：{str(error)[:160]}"
        RT.stats.tier2_failed += 1


# --------------------------------------------------------------------------- #
# 单路扫描（后台线程）
# --------------------------------------------------------------------------- #
def scan_stream(sid: str) -> None:
    cfg = RT.cfg
    st = stream_state(sid)
    now = time.time()
    jpeg, image = fetch_frame(sid)
    st.last_error = ""
    st.last_ok_ts = now
    st.frames += 1
    RT.stats.total_frames += 1
    st.ring.append(jpeg)

    ratio, gray, mask = motion_ratio(st.prev_gray, image)
    st.prev_gray = gray
    st.last_motion_pct = ratio
    moving = ratio is None or ratio >= cfg.motion_pct

    if RT.model_state != "ready" or RT.model is None or not RT.classes_applied:
        if moving:
            RT.stats.motion_only += 1
        else:
            RT.stats.tier0_filtered += 1
        st.last = {"ts": now, "image": image, "dets": [], "motion": ratio, "mask": mask}
        return

    recheck = (
        cfg.static_recheck > 0 and st.last_had_person and now - st.last_infer_ts >= cfg.static_recheck
    ) or st.has_pending
    if not moving and not recheck:
        RT.stats.tier0_filtered += 1
        st.last = {"ts": now, "image": image, "dets": [], "motion": ratio, "mask": mask, "filtered": True}
        return

    if st.tracker is None:
        st.tracker = make_tracker()
    dets = detect(image, st.tracker)
    st.last_infer_ts = now
    RT.stats.tier1_inferred += 1
    suspects, passed, persons = evaluate(dets)
    st.last_had_person = persons > 0
    st.last_persons = persons
    st.last = {"ts": now, "image": image, "dets": dets, "motion": ratio, "mask": None}

    if not suspects:
        RT.stats.tier1_passed += 1
        st.tracks.clear()
        st.has_pending = False
        return

    keys = {s.key for s in suspects}
    for key in list(st.tracks):
        if key not in keys:
            del st.tracks[key]
    triggered: list[Suspect] = []
    pending = False
    for suspect in suspects:
        prev = st.tracks.get(suspect.key)
        hits = (prev.hits + 1) if prev else 1
        st.tracks[suspect.key] = TrackState(hits=hits, last_conf=suspect.conf, reasons=suspect.reasons)
        if hits < cfg.min_frames:
            pending = True
            continue
        if st.cooldown.get(suspect.key, 0.0) > now:
            RT.stats.cooldown_suppressed += 1
            continue
        triggered.append(suspect)
    st.has_pending = pending

    if not triggered:
        RT.stats.tier1_pending += 1
        return

    annotated = encode_jpeg(draw(image, dets, header_text(ratio, dets)))
    frames = [base64.b64encode(raw).decode("ascii") for raw in list(st.ring)[-4:]]
    frames.append(base64.b64encode(annotated).decode("ascii"))
    for suspect in triggered:
        st.cooldown[suspect.key] = now + cfg.cooldown
        RT.stats.tier2_triggered += 1
        event = {
            "id": uuid.uuid4().hex[:12],
            "at": now_iso(),
            "streamId": sid,
            "trackId": suspect.key,
            "label": "；".join(suspect.reasons)[:60],
            "confidence": min(1.0, max(0.0, suspect.conf)),
            "reasons": suspect.reasons,
            "status": "pending",
            "summary": "",
            "alertId": None,
        }
        RT.events.appendleft(event)
        PUSH_POOL.submit(push_event, event, frames)
    for key in [k for k, until in st.cooldown.items() if until < now - 60]:
        del st.cooldown[key]


def scan_loop() -> None:
    while not STOP.is_set():
        cfg = RT.cfg
        if not cfg.enabled or not cfg.stream_ids:
            STOP.wait(0.5)
            continue
        interval = 1.0 / max(0.2, cfg.sample_fps)
        for sid in list(cfg.stream_ids):
            st = stream_state(sid)
            now = time.time()
            if now < st.next_at:
                continue
            st.next_at = now + interval
            try:
                scan_stream(sid)
            except Exception as error:  # noqa: BLE001
                st.last_error = str(error)[:160] or type(error).__name__
                st.next_at = time.time() + 3.0
        STOP.wait(0.03)


# --------------------------------------------------------------------------- #
# HTTP 接口
# --------------------------------------------------------------------------- #
@asynccontextmanager
async def lifespan(_: FastAPI):
    threading.Thread(target=load_model, name="model-loader", daemon=True).start()
    threading.Thread(target=scan_loop, name="scan-loop", daemon=True).start()
    yield
    STOP.set()
    PUSH_POOL.shutdown(wait=False, cancel_futures=True)


app = FastAPI(title="Vigil-AI vision-worker", lifespan=lifespan)


def classes_view() -> list[dict[str, str]]:
    return [
        {"promptEn": prompt, "labelZh": RT.label_map.get(prompt, ""), "role": RT.role_map.get(prompt, "")}
        for prompt in (RT.classes_applied or RT.pending_prompts)
    ]


@app.get("/health")
def health() -> dict[str, Any]:
    ready = RT.model_state == "ready"
    streams: dict[str, Any] = {}
    now = time.time()
    for sid in RT.cfg.stream_ids:
        st = RT.streams.get(sid)
        if st is None:
            streams[sid] = {"online": False, "monitored": True, "frames": 0, "error": ""}
            continue
        streams[sid] = {
            "online": bool(st.last_ok_ts) and now - st.last_ok_ts < 10 and not st.last_error,
            "monitored": True,
            "frames": st.frames,
            "motionPct": None if st.last_motion_pct is None else round(st.last_motion_pct, 2),
            "persons": st.last_persons,
            "pendingTracks": len(st.tracks),
            "error": st.last_error,
        }
    return {
        "ok": True,
        "status": RT.model_state,
        "mode": "yolo-world+" + RT.tracker_kind if ready else "motion-only",
        "reason": RT.reason,
        "device": RT.device,
        "modelLoaded": RT.model is not None,
        "weightsPath": str(WEIGHTS_PATH),
        "weightsPresent": WEIGHTS_PATH.exists(),
        "classes": classes_view(),
        "vocabulary": list(RT.classes_applied or RT.pending_prompts),
        "trackerKind": RT.tracker_kind,
        "stats": RT.stats.as_dict(),
        "streams": streams,
        "recentEvents": list(RT.events)[:12],
        "versions": RT.versions,
        "lastReloadMs": RT.last_reload_ms,
        "uptimeSec": int(time.time() - RT.started_at),
        "enabled": RT.cfg.enabled,
        "sampleFps": RT.cfg.sample_fps,
    }


@app.post("/stats/reset")
def reset_stats() -> dict[str, Any]:
    RT.stats.reset()
    return {"ok": True}


@app.post("/config/reload")
def config_reload(req: ReloadRequest) -> dict[str, Any]:
    started = time.perf_counter()
    low = min(0.95, max(0.05, req.confidenceLow))
    high = min(0.99, max(low + 0.05, req.confidenceHigh))
    cfg = Config(
        enabled=req.enabled,
        sample_fps=min(10.0, max(0.2, req.sampleFps)),
        motion_pct=min(50.0, max(0.0, req.motionThresholdPct)),
        low=low,
        high=high,
        min_frames=min(30, max(1, req.minConsecutiveFrames)),
        cooldown=min(3600.0, max(0.0, req.cooldownSeconds)),
        static_recheck=min(300.0, max(0.0, req.staticRecheckSec)),
        stream_ids=[s for s in dict.fromkeys(req.streamIds) if s],
        go2rtc=req.go2rtcUrl.rstrip("/") or "http://127.0.0.1:1984",
        trigger_url=req.triggerUrl.strip(),
    )
    prompts: list[str] = []
    role_map: dict[str, str] = {}
    label_map: dict[str, str] = {}
    for item in req.vocabulary:
        prompt = " ".join(item.promptEn.split())
        if not item.enabled or not prompt or item.role not in ROLES or prompt in role_map:
            continue
        prompts.append(prompt)
        role_map[prompt] = item.role
        label_map[prompt] = item.labelZh
    with RT.cfg_lock:
        RT.cfg = cfg
        RT.role_map = role_map
        RT.label_map = label_map
        RT.vocab = list(req.vocabulary)
        RT.pending_prompts = prompts
        for sid in list(RT.streams):
            if sid not in cfg.stream_ids:
                del RT.streams[sid]
    ok, message = apply_classes(prompts)
    RT.last_reload_ms = round((time.perf_counter() - started) * 1000, 1)
    log(f"配置已热更新（{RT.last_reload_ms}ms）：{len(prompts)} 个词条 · {len(cfg.stream_ids)} 路通道 · {message}")
    return {
        "ok": ok,
        "reloadMs": RT.last_reload_ms,
        "message": message,
        "status": RT.model_state,
        "reason": RT.reason,
        "classes": classes_view(),
    }


def fresh_view(sid: str, force: bool = False) -> dict[str, Any]:
    """返回该通道最新的一帧检测结果：监控线程刚处理过的直接复用，否则现场抓帧推理一次。"""
    st = stream_state(sid)
    cached = st.last
    if not force and cached and time.time() - cached["ts"] < FRESH_SECONDS and not cached.get("filtered"):
        return {**cached, "reused": True}
    try:
        jpeg, image = fetch_frame(sid)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"无法获取通道画面：{str(error)[:160]}") from error
    ratio, gray, mask = motion_ratio(st.preview_gray, image)
    st.preview_gray = gray
    dets: list[Det] = []
    if RT.model_state == "ready" and RT.model is not None and RT.classes_applied:
        if st.preview_tracker is None:
            st.preview_tracker = make_tracker()
        dets = detect(image, st.preview_tracker)
    return {"ts": time.time(), "image": image, "dets": dets, "motion": ratio, "mask": mask, "reused": False}


@app.get("/streams/{stream_id}/annotated.jpg")
def annotated(stream_id: str) -> Response:
    view = fresh_view(stream_id)
    degraded = RT.model_state != "ready"
    canvas = draw(view["image"], view["dets"], header_text(view["motion"], view["dets"]), view.get("mask") if degraded else None, degraded)
    return Response(content=encode_jpeg(canvas), media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.post("/streams/{stream_id}/inspect-once")
def inspect_once(stream_id: str) -> dict[str, Any]:
    started = time.perf_counter()
    view = fresh_view(stream_id, force=True)
    dets: list[Det] = view["dets"]
    degraded = RT.model_state != "ready"
    suspects, passed, persons = evaluate(dets) if not degraded else ([], 0, 0)
    if degraded:
        decision = "degraded"
    elif suspects:
        decision = "suspect"
    elif persons:
        decision = "passed"
    else:
        decision = "no-target"
    canvas = draw(view["image"], dets, header_text(view["motion"], dets), view.get("mask") if degraded else None, degraded)
    st = stream_state(stream_id)
    return {
        "ok": True,
        "streamId": stream_id,
        "mode": "motion-only" if degraded else "yolo-world+" + RT.tracker_kind,
        "device": RT.device,
        "degraded": degraded,
        "reason": RT.reason,
        "motionPct": None if view["motion"] is None else round(view["motion"], 2),
        "latencyMs": round((time.perf_counter() - started) * 1000, 1),
        "detections": [
            {
                "prompt": d.prompt,
                "labelZh": RT.label_map.get(d.prompt, ""),
                "role": d.role,
                "confidence": round(d.conf, 3),
                "trackId": d.track_id,
                "box": [round(v, 1) for v in d.box],
            }
            for d in dets
        ],
        "gate": {
            "decision": decision,
            "persons": persons,
            "passedPersons": passed,
            "minConsecutiveFrames": RT.cfg.min_frames,
            "suspects": [
                {
                    "key": s.key,
                    "trackId": s.track_id,
                    "confidence": s.conf,
                    "reasons": s.reasons,
                    "hits": st.tracks[s.key].hits if s.key in st.tracks else 0,
                }
                for s in suspects
            ],
        },
        "thresholds": {
            "motionThresholdPct": RT.cfg.motion_pct,
            "confidenceLow": RT.cfg.low,
            "confidenceHigh": RT.cfg.high,
        },
        "annotatedJpegBase64": base64.b64encode(encode_jpeg(canvas)).decode("ascii"),
    }


if __name__ == "__main__":
    log(f"监听 http://{HOST}:{PORT}，模型目录 {MODELS_DIR}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning", access_log=False)
