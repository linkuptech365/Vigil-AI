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
import math
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
ROLE_SUBJECT = "subject_target"
ROLE_CONTEXT = "context_object"
POLICY_DUAL = "DUAL_INTERACTION"
POLICY_ANCHOR = "ANCHOR_PROXIMITY"
ANCHOR_MIN_FRAMES = 3  # 主体停留在记忆锚点内的最少连续帧
EXPLORE_MIN_FRAMES = 5  # 冷启动探索：主体在同一区域停留的最少连续帧
EXPLORE_LINGER = 90.0  # 冷启动探索：判定"同一区域"的中心位移上限（0-1000 归一化坐标）
EXPLORE_COOLDOWN = 120.0  # 冷启动探索被二级驳回后的最短重试间隔（秒）
EXPLORE_RADIUS = 150.0  # 探索确认后默认下发的锚点半径
MAX_LEARNED_TAGS = 6
ROLES = (ROLE_ANCHOR, ROLE_PPE, ROLE_HAZARD, ROLE_SUBJECT, ROLE_CONTEXT)
# 规则管道专用类别：只供管道门禁匹配，不参与 PPE / 关系 / 锚点 / 围栏等既有判定，避免通用类别误触发旧逻辑
ROLE_PIPE = "pipeline_class"
WILDCARD = "*"
PIPE_CELL = 250.0  # 无 track_id 的主体按 0-1000 坐标的 250 网格划分冷却单元

ROLE_COLORS = {  # BGR
    ROLE_ANCHOR: (255, 140, 30),
    ROLE_PPE: (90, 200, 80),
    ROLE_HAZARD: (60, 60, 235),
    ROLE_SUBJECT: (0, 150, 255),
    ROLE_CONTEXT: (200, 160, 40),
}

RING_SIZE = 5
FRESH_SECONDS = 2.5
MAX_EVENTS = 30
MAX_HIT_LOG = 80
HIT_DEDUPE_SECONDS = 8.0
MAX_GATE_TRACES = 300
GATE_TRACE_REPEAT_SECONDS = 3.0  # 同一门禁同一结论的重复追踪合并窗口，避免 2~3 FPS 下刷屏
WAIST_RATIO = 0.55  # HAND_ELEVATED：手中心高于人员框「框顶 + 55% 高度」视为抬起
SMOKING_KEYWORDS = ("吸烟", "抽烟", "smok", "cigarette")
# 吸烟类规则的冷却上限（秒）：排查"无命中无告警"期间避免冷却锁吞掉真实事件；设为 0 关闭该上限
SMOKING_COOLDOWN_CAP = max(0.0, float(os.environ.get("VIGIL_SMOKING_COOLDOWN_CAP", "30") or 0))


# --------------------------------------------------------------------------- #
# 配置与全局状态
# --------------------------------------------------------------------------- #
class VocabItem(BaseModel):
    id: str = ""
    labelZh: str = ""
    promptEn: str
    role: str = ROLE_HAZARD
    enabled: bool = True


class ZoneItem(BaseModel):
    id: str
    name: str = ""
    type: str = "polygon"
    cameraId: str = ""
    coordinates: list[list[float]] = Field(default_factory=list)
    directional: bool = False
    targets: list[str] = Field(default_factory=lambda: ["person"])


class LearnTagItem(BaseModel):
    promptEn: str
    labelZh: str = ""
    role: str = ROLE_SUBJECT
    confidence: float = 0.3


class LearnAnchorItem(BaseModel):
    center: list[float] = Field(default_factory=lambda: [500.0, 500.0])
    radius: float = 150.0
    description: str = ""


class LearningItem(BaseModel):
    version: int = 0
    policy: str = POLICY_DUAL
    tags: list[LearnTagItem] = Field(default_factory=list)
    anchor: LearnAnchorItem | None = None


class PerceptionGate(BaseModel):
    subject_classes: list[str] = Field(default_factory=lambda: ["person"])
    require_roi: bool = False
    bound_roi_ids: list[str] = Field(default_factory=list)
    hand_pose_filter: str = "NONE"


class InteractionGate(BaseModel):
    require_context_object: bool = False
    context_classes: list[str] = Field(default_factory=list)
    max_interaction_distance: float | None = None


class VlmArbitration(BaseModel):
    system_intent_prompt: str = ""
    negative_exclusions: list[str] = Field(default_factory=list)


class Throttling(BaseModel):
    track_cooldown_seconds: float = 90.0
    enable_shadow_review: bool = False


class PipelineItem(BaseModel):
    id: str
    name: str = ""
    boundChannels: list[str] = Field(default_factory=lambda: ["ALL"])
    perception_gate: PerceptionGate = Field(default_factory=PerceptionGate)
    interaction_gate: InteractionGate = Field(default_factory=InteractionGate)
    vlm_arbitration: VlmArbitration = Field(default_factory=VlmArbitration)
    throttling: Throttling = Field(default_factory=Throttling)


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
    channelVocabulary: dict[str, list[VocabItem]] = Field(default_factory=dict)
    zones: list[ZoneItem] = Field(default_factory=list)
    streamIds: list[str] = Field(default_factory=list)
    learning: dict[str, LearningItem] = Field(default_factory=dict)
    rulePipelines: list[PipelineItem] = Field(default_factory=list)
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
    zones: list[dict[str, Any]] = field(default_factory=list)
    learning: dict[str, dict[str, Any]] = field(default_factory=dict)
    pipelines: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Det:
    prompt: str
    role: str
    conf: float
    box: tuple[float, float, float, float]
    track_id: int | None = None
    floor: float | None = None  # VLM 反哺词条自带的置信度门槛，优先于全局 confidenceLow


@dataclass
class Suspect:
    key: str
    track_id: int | None
    conf: float
    reasons: list[str]
    instant: bool = False  # 绊线越界是瞬时事件，不走连续帧门控
    min_frames: int | None = None  # 覆盖全局连续帧门槛（记忆锚点停留判定使用）
    anchor: bool = False  # 由记忆锚点靠近触发
    explore: bool = False  # 冷启动探索：主体在同一区域停留，但伴生物体未检出
    hint: dict[str, Any] | None = None  # 探索时随送审附带的空间线索（center/radius/subject）
    cooldown: float | None = None  # 覆盖全局冷却（规则管道按规则配置的 track_cooldown_seconds）
    rule_id: str | None = None  # 规则管道放行的事件：送审时只用该规则研判
    shadow: bool = False  # 规则管道开启静默存疑审计且置信度模糊：复核结果只留痕不告警


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
    zone_side: dict[str, float] = field(default_factory=dict)
    explore_ref: dict[str, tuple[float, float]] = field(default_factory=dict)
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
    last_entry: dict[str, Any] | None = None
    last_entry_sig: str = ""
    last_entry_ts: float = 0.0


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
        # 当前已写入 YOLO-World 的词表（模型一次只能加载一套，按通道切换）
        self.classes_applied: list[str] = []
        # 默认词表：没有专属词表的通道使用
        self.default_prompts: list[str] = []
        self.default_roles: dict[str, str] = {}
        self.default_labels: dict[str, str] = {}
        # 通道独立词表上下文：channel_id -> 该通道专属的英文词表（含该通道自己的二级反哺词条）
        self.channel_model_contexts: dict[str, list[str]] = {}
        self.channel_roles: dict[str, dict[str, str]] = {}
        self.channel_labels: dict[str, dict[str, str]] = {}
        self.channel_source: dict[str, str] = {}
        self.learned_conf: dict[tuple[str, str], float] = {}
        self.streams: dict[str, StreamState] = {}
        self.events: deque = deque(maxlen=MAX_EVENTS)
        self.hitlog: deque = deque(maxlen=MAX_HIT_LOG)
        # 规则管道门禁逐级诊断：环形缓冲 + 同一 (通道, 规则, 门禁, 结论) 的节流时间戳
        self.gate_traces: deque = deque(maxlen=MAX_GATE_TRACES)
        self.gate_trace_last: dict[str, float] = {}
        self.tracker_kind = "bytetrack"
        self.last_reload_ms = 0.0
        self.model_lock = threading.RLock()
        self.cfg_lock = threading.RLock()
        # 词表后台更新：updating 由 pending 计数推导，/health 只读这些字段，绝不取锁
        self.vocab_version = 0
        self.update_pending = 0
        self.update_started = 0.0
        self.update_state_lock = threading.Lock()
        # 词表 -> 已编码的 CLIP 文本嵌入快照；通道间切换词表时直接还原，不再重复跑 CLIP 文本编码
        self.vocab_cache: dict[tuple[str, ...], dict[str, Any] | None] = {}

    @property
    def updating(self) -> bool:
        return self.update_pending > 0


RT = Runtime()
STOP = threading.Event()
HTTP = httpx.Client(timeout=httpx.Timeout(10.0, connect=3.0))
PUSH_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="tier2-push")
# 单线程：词表更新严格串行，且永远不占用 uvicorn 事件循环与 anyio 线程池
VOCAB_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vocab-update")
# CPU 推理总帧率预算（所有通道合计）；GPU/MPS 不受限
CPU_TOTAL_FPS = max(0.5, float(os.environ.get("VIGIL_CPU_MAX_FPS", "3") or 3))
VOCAB_CACHE_MAX = 16


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    print(f"[vision-worker] {message}", flush=True)


def gate_trace(sid: str, rule_id: str, rule_name: str, gate: str, verdict: str, detail: str) -> None:
    """门禁诊断：写控制台 + 内存环形缓冲（/gate-traces）。verdict: pass | block | info。"""
    now = time.time()
    signature = f"{sid}|{rule_id}|{gate}|{verdict}"
    last = RT.gate_trace_last.get(signature)
    if last is not None and now - last < GATE_TRACE_REPEAT_SECONDS:
        return
    RT.gate_trace_last[signature] = now
    if len(RT.gate_trace_last) > 600:
        cutoff = now - 60
        for key in [k for k, ts in RT.gate_trace_last.items() if ts < cutoff]:
            del RT.gate_trace_last[key]
    RT.gate_traces.appendleft(
        {
            "at": now_iso(),
            "streamId": sid,
            "ruleId": rule_id,
            "ruleName": rule_name,
            "gate": gate,
            "verdict": verdict,
            "detail": detail,
        }
    )
    tag = {"pass": "PASS", "block": "BLOCK"}.get(verdict, "INFO")
    log(f"{gate} {tag} stream={sid or '-'} rule={rule_name or rule_id} {detail}")


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


def remember_classes(prompts: list[str]) -> None:
    """set_classes 成功后抓取文本嵌入快照；内部结构与预期不符时记 None，之后每次都退回完整 set_classes。"""
    key = tuple(prompts)
    snapshot: dict[str, Any] | None = None
    try:
        inner = RT.model.model
        txt_feats = getattr(inner, "txt_feats", None)
        head = inner.model[-1]
        if txt_feats is not None and hasattr(head, "nc"):
            snapshot = {"txt_feats": txt_feats, "nc": head.nc, "names": [p for p in prompts if p != " "]}
    except Exception:  # noqa: BLE001
        snapshot = None
    if len(RT.vocab_cache) >= VOCAB_CACHE_MAX:
        RT.vocab_cache.pop(next(iter(RT.vocab_cache)))
    RT.vocab_cache[key] = snapshot


def restore_classes(prompts: list[str]) -> bool:
    """命中缓存时直接还原文本嵌入（毫秒级），不触发 CLIP 文本编码与任何磁盘/网络读取。调用方需持有 model_lock。"""
    snapshot = RT.vocab_cache.get(tuple(prompts))
    if not snapshot:
        return False
    try:
        inner = RT.model.model
        inner.txt_feats = snapshot["txt_feats"]
        inner.model[-1].nc = snapshot["nc"]
        inner.names = list(snapshot["names"])
        predictor = getattr(RT.model, "predictor", None)
        if predictor is not None:
            predictor.model.names = list(snapshot["names"])
        return True
    except Exception as error:  # noqa: BLE001
        log(f"词表缓存还原失败，改走完整编码：{str(error)[:120]}")
        RT.vocab_cache.pop(tuple(prompts), None)
        return False


def run_vocab_update(version: int) -> None:
    """后台线程：预热所有通道词表的文本嵌入并写入首个词表。被更新的配置取代时立即放弃。"""
    started = time.perf_counter()
    try:
        if RT.model is None:
            return
        contexts = distinct_contexts()
        for prompts in contexts:
            if version != RT.vocab_version:
                log(f"词表更新 v{version} 已被 v{RT.vocab_version} 取代，放弃")
                return
            apply_classes(list(prompts))
        first = contexts[0] if contexts else []
        ok, message = apply_classes(list(first))
        log(f"词表后台应用完成（{(time.perf_counter() - started) * 1000:.0f}ms，{len(contexts)} 套上下文）：{message}")
    except Exception as error:  # noqa: BLE001
        log(f"词表后台更新异常：{str(error)[:200]}")
    finally:
        with RT.update_state_lock:
            RT.update_pending = max(0, RT.update_pending - 1)


def schedule_vocab_update() -> None:
    """把词表更新丢到后台线程并立即返回；绝不在请求线程/事件循环里调用 set_classes。"""
    with RT.update_state_lock:
        RT.update_pending += 1
        if RT.update_pending == 1:
            RT.update_started = time.time()
    version = RT.vocab_version
    try:
        VOCAB_POOL.submit(run_vocab_update, version)
    except RuntimeError:
        with RT.update_state_lock:
            RT.update_pending = max(0, RT.update_pending - 1)


def effective_fps(cfg: Config) -> float:
    """CPU 推理按总预算限帧（默认 3 FPS 合计、均分到各通道），避免占满 CPU 拖死接口；GPU/MPS 不受限。"""
    fps = max(0.2, cfg.sample_fps)
    if RT.device == "cpu" and RT.model_state == "ready" and RT.model is not None:
        fps = min(fps, max(0.5, CPU_TOTAL_FPS / max(1, len(cfg.stream_ids))))
    return fps


def apply_classes(prompts: list[str]) -> tuple[bool, str]:
    """把词表写入 YOLO-World（内存热切换，不重启进程，也不重置 ByteTrack 轨迹）。"""
    if RT.model is None:
        return False, RT.reason
    if not prompts:
        RT.classes_applied = []
        return True, "词表为空，已暂停 Tier-1 推理"
    if prompts == RT.classes_applied and RT.model_state == "ready":
        return True, "词表未变化"
    try:
        with RT.model_lock:
            if not restore_classes(prompts):
                started = time.perf_counter()
                # set_classes 会原地修改传入列表，必须传副本
                RT.model.set_classes(list(prompts))
                elapsed = time.perf_counter() - started
                if elapsed > 2.0:
                    log(f"词表编码耗时 {elapsed:.1f}s（{len(prompts)} 条）")
                remember_classes(prompts)
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
        if RT.device == "cpu":
            # 留出至少 1 个核心给事件循环与 /health，避免 torch 吃满全部核心
            threads = int(os.environ.get("VIGIL_TORCH_THREADS", "0") or 0) or max(1, (os.cpu_count() or 2) - 1)
            torch.set_num_threads(threads)
            RT.versions["torchThreads"] = str(threads)
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
    RT.model_state = "ready"
    RT.reason = ""
    if first_context():
        schedule_vocab_update()


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
def prompts_of(sid: str) -> list[str]:
    """该通道专属的检测词表；未单独配置的通道回落到默认词表。"""
    return RT.channel_model_contexts.get(sid, RT.default_prompts)


def roles_of(sid: str) -> dict[str, str]:
    return RT.channel_roles.get(sid, RT.default_roles)


def labels_of(sid: str) -> dict[str, str]:
    return RT.channel_labels.get(sid, RT.default_labels)


def distinct_contexts() -> list[list[str]]:
    seen: list[list[str]] = []
    for prompts in [RT.default_prompts, *RT.channel_model_contexts.values()]:
        if prompts and prompts not in seen:
            seen.append(prompts)
    return seen


def first_context() -> list[str]:
    contexts = distinct_contexts()
    return contexts[0] if contexts else []


def display_prompts() -> list[str]:
    """仅用于展示：所有通道词表的并集（推理时绝不合并）。"""
    merged: list[str] = []
    for prompts in distinct_contexts():
        for prompt in prompts:
            if prompt not in merged:
                merged.append(prompt)
    return merged


def passes(det: Det, low: float) -> bool:
    return det.conf >= (det.floor if det.floor is not None else low)


def detect(image: np.ndarray, tracker: Any, sid: str = "") -> list[Det]:
    low = RT.cfg.low
    conf_floor = max(0.05, min(0.25, low))
    prompts = prompts_of(sid)
    roles = roles_of(sid)
    if not prompts:
        return []
    # 同一把锁内切换词表并推理，保证本帧只用本通道的词表做文本-图像内积
    with RT.model_lock:
        ok, _ = apply_classes(prompts)
        if not ok:
            return []
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
            role = roles.get(prompt)
            if role is None:
                continue
            floor = RT.learned_conf.get((sid, prompt))
            if floor is not None and float(confs[k]) < floor:
                continue
            x1, y1, x2, y2 = (float(v) for v in xyxy[k])
            dets.append(Det(prompt=prompt, role=role, conf=float(confs[k]), box=(x1, y1, x2, y2), floor=floor))
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


def label_of(prompt: str, sid: str = "") -> str:
    return labels_of(sid).get(prompt) or prompt


def evaluate(dets: list[Det], sid: str = "") -> tuple[list[Suspect], int, int]:
    """三阶门控：返回（疑似目标列表, 合规放行人数, 画面中人数）���"""
    low, high = RT.cfg.low, RT.cfg.high
    required = [p for p, r in roles_of(sid).items() if r == ROLE_PPE and p in prompts_of(sid)]
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
                reasons.append(f"缺失必需劳保：{label_of(prompt, sid)}")
                suspect_conf = max(suspect_conf, person.conf)
        for hid, hazard in enumerate(hazards):
            if inside(hazard, person) or iou(hazard.box, person.box) > 0:
                reasons.append(f"命中违规目标：{label_of(hazard.prompt, sid)}（{hazard.conf:.2f}）")
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
                reasons=[f"画面中检出违规目标：{label_of(hazard.prompt, sid)}（{hazard.conf:.2f}）"],
            )
        )
    suspects.extend(relation_suspects(dets, sid))
    return suspects, passed, len(persons)


def proximity(subject: Det, other: Det) -> float | None:
    """两框 IOU>0 返回 IOU；不重叠但主体框外扩 25% 后相交，视为"靠近"返回 0.0；否则 None。"""
    overlap = iou(subject.box, other.box)
    if overlap > 0:
        return overlap
    x1, y1, x2, y2 = subject.box
    pad = 0.25 * max(x2 - x1, y2 - y1)
    grown = (x1 - pad, y1 - pad, x2 + pad, y2 + pad)
    return 0.0 if iou(grown, other.box) > 0 else None


def relation_suspects(dets: list[Det], sid: str = "") -> list[Suspect]:
    """行为主体（如猫）与关联物体（如喂食器/食盆）空间靠近或重叠才判为疑似。

    词表里没有任何启用的关联物体时，行为主体一出现即判为疑似（等价于违规目标）。
    """
    low = RT.cfg.low
    subjects = [d for d in dets if d.role == ROLE_SUBJECT and passes(d, low)]
    if not subjects:
        return []
    contexts = [d for d in dets if d.role == ROLE_CONTEXT and passes(d, low)]
    context_configured = any(r == ROLE_CONTEXT and p in prompts_of(sid) for p, r in roles_of(sid).items())
    best: dict[str, Suspect] = {}
    for subject in subjects:
        key = f"rel:{subject.prompt}"
        if not context_configured:
            candidate = Suspect(
                key=key, track_id=None, conf=round(subject.conf, 3),
                reasons=[f"画面中检出行为主体：{label_of(subject.prompt, sid)}（{subject.conf:.2f}）"],
            )
        else:
            candidate = None
            for other in contexts:
                score = proximity(subject, other)
                if score is None:
                    continue
                conf = min(subject.conf, other.conf)
                if candidate is not None and conf <= candidate.conf:
                    continue
                relation = f"重叠（IOU {score:.2f}）" if score > 0 else "靠近"
                candidate = Suspect(
                    key=key, track_id=None, conf=round(conf, 3),
                    reasons=[f"{label_of(subject.prompt, sid)} 与 {label_of(other.prompt, sid)} 空间{relation}"],
                )
            if candidate is None:
                continue
        current = best.get(key)
        if current is None or candidate.conf > current.conf:
            best[key] = candidate
    return list(best.values())


def explore_suspects(
    sid: str, dets: list[Det], shape: tuple[int, int], st: StreamState, relation_keys: set[str]
) -> list[Suspect]:
    """冷启动探索：通道还没有学到 spatial_hotspot 锚点时，行为主体（如猫）在同一区域连续停留，
    即使伴生物体（喂食器）没被检出，也允许发起一次二级研判，让 VLM 去确认并反哺锚点。

    只在"词表里配了伴生物体但本帧没有配对成功"时补位；已有关系疑似或已学到锚点的主体不重复触发。
    主体中心位移超过 EXPLORE_LINGER 视为离开该区域，停留计数重新开始。
    """
    learn = RT.cfg.learning.get(sid)
    if learn and learn.get("anchor"):
        st.explore_ref.clear()
        return []
    height, width = shape
    best: dict[str, Suspect] = {}
    seen: set[str] = set()
    for det in dets:
        if det.role != ROLE_SUBJECT or not passes(det, RT.cfg.low):
            continue
        if f"rel:{det.prompt}" in relation_keys:
            continue
        key = f"explore:{det.prompt}"
        seen.add(key)
        cx = (det.box[0] + det.box[2]) / 2 / max(1, width) * 1000.0
        cy = (det.box[1] + det.box[3]) / 2 / max(1, height) * 1000.0
        ref = st.explore_ref.get(key)
        if ref is not None and math.hypot(cx - ref[0], cy - ref[1]) > EXPLORE_LINGER:
            st.explore_ref[key] = (cx, cy)
            continue
        if ref is None:
            st.explore_ref[key] = (cx, cy)
            ref = (cx, cy)
        current = best.get(key)
        if current is None or det.conf > current.conf:
            best[key] = Suspect(
                key=key, track_id=None, conf=round(det.conf, 3),
                reasons=[f"冷启动探索：{label_of(det.prompt, sid)} 在同一区域停留，未检出伴生物体"],
                min_frames=EXPLORE_MIN_FRAMES, explore=True,
                hint={
                    "center": [round(ref[0], 1), round(ref[1], 1)],
                    "radius": EXPLORE_RADIUS,
                    "subject": det.prompt,
                    "subjectLabel": label_of(det.prompt, sid),
                },
            )
    for key in [k for k in st.explore_ref if k not in seen]:
        del st.explore_ref[key]
    return list(best.values())


def anchor_of(sid: str) -> dict[str, Any] | None:
    learn = RT.cfg.learning.get(sid)
    return learn.get("anchor") if learn else None


def anchor_suspects(sid: str, dets: list[Det], shape: tuple[int, int]) -> list[Suspect]:
    """记忆锚点：策略为 ANCHOR_PROXIMITY 时，行为主体中心落入锚点半径即判疑似，不再依赖伴生物体被检出。"""
    learn = RT.cfg.learning.get(sid)
    anchor = learn.get("anchor") if learn else None
    if not learn or learn.get("policy") != POLICY_ANCHOR or not anchor:
        return []
    height, width = shape
    ax, ay = anchor["center"]
    radius = max(1.0, float(anchor["radius"]))
    desc = anchor.get("description") or "记忆锚点"
    best: dict[str, Suspect] = {}
    for det in dets:
        if det.role != ROLE_SUBJECT or not passes(det, RT.cfg.low):
            continue
        cx = (det.box[0] + det.box[2]) / 2 / max(1, width) * 1000.0
        cy = (det.box[1] + det.box[3]) / 2 / max(1, height) * 1000.0
        dist = math.hypot(cx - ax, cy - ay)
        if dist > radius:
            continue
        key = f"anchor:{det.prompt}"
        current = best.get(key)
        if current is None or det.conf > current.conf:
            best[key] = Suspect(
                key=key, track_id=None, conf=round(det.conf, 3),
                reasons=[f"{label_of(det.prompt, sid)} 靠近记忆锚点「{desc}」（距离 {dist:.0f}/{radius:.0f}）"],
                min_frames=ANCHOR_MIN_FRAMES, anchor=True,
            )
    return list(best.values())


# --------------------------------------------------------------------------- #
# 电子围栏（坐标均为画面百分比 0-100，与前端一致）
# --------------------------------------------------------------------------- #
def zones_for(sid: str) -> list[dict[str, Any]]:
    return [z for z in RT.cfg.zones if z.get("cameraId") == sid]


def point_in_polygon(x: float, y: float, polygon: list[list[float]]) -> bool:
    inside_flag = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside_flag = not inside_flag
        j = i
    return inside_flag


def line_side(x: float, y: float, a: list[float], b: list[float]) -> float:
    return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])


def project_on_segment(x: float, y: float, a: list[float], b: list[float]) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length2 = dx * dx + dy * dy
    return 0.0 if length2 == 0 else ((x - a[0]) * dx + (y - a[1]) * dy) / length2


def zone_suspects(
    sid: str, dets: list[Det], shape: tuple[int, int], side_store: dict[str, float] | None
) -> list[Suspect]:
    """人员脚点（框底中心）落入多边形，或越过绊线，即视为疑似。side_store 为 None 时只做无状态的多边形判定。"""
    zones = zones_for(sid)
    if not zones:
        return []
    height, width = shape
    persons = [d for d in dets if d.role == ROLE_ANCHOR and d.conf >= RT.cfg.low]
    subjects = [d for d in dets if d.role == ROLE_SUBJECT and passes(d, RT.cfg.low)]
    suspects: list[Suspect] = []
    for zone in zones:
        coords = zone.get("coordinates") or []
        targets = zone.get("targets") or ["person"]
        if zone.get("type") == "polygon" and len(coords) >= 3 and any(t != "person" for t in targets):
            # 围栏入侵与全景行为感知并行：非人员围栏只负责"主体进入围栏"，不影响围栏外目标的全景判定
            for index, subject in enumerate(subjects):
                foot_x = (subject.box[0] + subject.box[2]) / 2 / max(1, width) * 100.0
                foot_y = subject.box[3] / max(1, height) * 100.0
                if point_in_polygon(foot_x, foot_y, coords):
                    suspects.append(
                        Suspect(
                            key=f"zone:{zone['id']}:s{index}",
                            track_id=None,
                            conf=round(subject.conf, 3),
                            reasons=[f"{label_of(subject.prompt, sid)} 进�����子围栏：{zone.get('name') or zone['id']}"],
                        )
                    )
        if "person" not in targets:
            continue
        for index, person in enumerate(persons):
            foot_x = (person.box[0] + person.box[2]) / 2 / max(1, width) * 100.0
            foot_y = person.box[3] / max(1, height) * 100.0
            who = f"t{person.track_id}" if person.track_id is not None else f"p{index}"
            if zone.get("type") == "polygon" and len(coords) >= 3:
                if point_in_polygon(foot_x, foot_y, coords):
                    suspects.append(
                        Suspect(
                            key=f"zone:{zone['id']}:{who}",
                            track_id=person.track_id,
                            conf=round(person.conf, 3),
                            reasons=[f"人员进入电子围栏：{zone.get('name') or zone['id']}"],
                        )
                    )
            elif zone.get("type") == "tripwire" and len(coords) == 2 and side_store is not None and person.track_id is not None:
                a, b = coords
                side = line_side(foot_x, foot_y, a, b)
                memo_key = f"{zone['id']}:{person.track_id}"
                prev = side_store.get(memo_key)
                side_store[memo_key] = side
                if prev is None or prev * side >= 0:
                    continue
                if not 0.0 <= project_on_segment(foot_x, foot_y, a, b) <= 1.0:
                    continue
                if zone.get("directional") and side <= 0:
                    continue
                suspects.append(
                    Suspect(
                        key=f"zone:{zone['id']}:{who}",
                        track_id=person.track_id,
                        conf=round(person.conf, 3),
                        reasons=[f"人员越过电子围栏绊线：{zone.get('name') or zone['id']}"],
                        instant=True,
                    )
                )
    if side_store is not None and len(side_store) > 400:
        side_store.clear()
    return suspects


# --------------------------------------------------------------------------- #
# 通用规则管道：门禁式逐级阻断（主体 → 空间 → 伴生物体 → 冷却 → 送审）
# --------------------------------------------------------------------------- #
def norm_class(text: str) -> str:
    return " ".join(str(text).split()).lower()


def effective_cooldown(rule_id: str, name: str, classes: list[str], configured: float) -> float:
    """吸烟类规则冷却不超过 SMOKING_COOLDOWN_CAP，避免长冷却吞掉真实事件；其余规则保持配置值。"""
    haystack = " ".join([name or "", *classes]).lower()
    if SMOKING_COOLDOWN_CAP > 0 and any(k in haystack for k in SMOKING_KEYWORDS) and configured > SMOKING_COOLDOWN_CAP:
        log(f"规则 {name or rule_id} 为吸烟类，冷却 {configured:.0f}s 限制为 {SMOKING_COOLDOWN_CAP:.0f}s")
        return SMOKING_COOLDOWN_CAP
    return configured


def pipelines_for(sid: str) -> list[dict[str, Any]]:
    return [p for p in RT.cfg.pipelines if "ALL" in p["channels"] or sid in p["channels"]]


def matches_class(det: Det, classes: list[str]) -> bool:
    """类别匹配：词表原文（忽略大小写）命中；person 兼容人员锚点；* 匹配任意主体/人员。"""
    prompt = norm_class(det.prompt)
    for raw in classes:
        wanted = norm_class(raw)
        if wanted == WILDCARD and det.role in (ROLE_ANCHOR, ROLE_SUBJECT, ROLE_PIPE):
            return True
        if wanted == prompt or (wanted == "person" and det.role == ROLE_ANCHOR):
            return True
    return False


def box_center_norm(det: Det, shape: tuple[int, int]) -> tuple[float, float]:
    height, width = shape
    return (
        (det.box[0] + det.box[2]) / 2 / max(1, width) * 1000.0,
        (det.box[1] + det.box[3]) / 2 / max(1, height) * 1000.0,
    )


def box_hits_polygon(det: Det, polygon: list[list[float]], shape: tuple[int, int]) -> bool:
    """框中心、脚点、四角任一落入围栏，或围栏顶点落入框内，即视为相交（围栏坐标为 0-100 百分比）。"""
    height, width = shape
    x1, y1, x2, y2 = (det.box[0] / max(1, width) * 100.0, det.box[1] / max(1, height) * 100.0,
                      det.box[2] / max(1, width) * 100.0, det.box[3] / max(1, height) * 100.0)
    probes = [((x1 + x2) / 2, (y1 + y2) / 2), ((x1 + x2) / 2, y2), (x1, y1), (x2, y1), (x1, y2), (x2, y2)]
    if any(point_in_polygon(px, py, polygon) for px, py in probes):
        return True
    return any(x1 <= vx <= x2 and y1 <= vy <= y2 for vx, vy in polygon)


def is_person(det: Det) -> bool:
    return det.role == ROLE_ANCHOR or norm_class(det.prompt) == "person"


def is_hand(det: Det) -> bool:
    return "hand" in norm_class(det.prompt)


def fmt_box(det: Det) -> str:
    return f"({int(det.box[0])},{int(det.box[1])},{int(det.box[2])},{int(det.box[3])})"


def seen_summary(dets: list[Det], limit: int = 8) -> str:
    if not dets:
        return "无任何检出"
    ordered = sorted(dets, key=lambda d: -d.conf)[:limit]
    return ", ".join(f"{d.prompt}:{d.conf:.2f}" for d in ordered)


def hand_pose_check(hand: Det, live: list[Det]) -> tuple[bool | None, str]:
    """手部抬起/探出的几何近似：手中心高于最近人员框的腰线（框顶 + 55% 高度）。
    返回 (结论, 诊断文本)；结论为 None 表示画面无人员框，无法判定。"""
    hx, hy = (hand.box[0] + hand.box[2]) / 2, (hand.box[1] + hand.box[3]) / 2
    persons = [d for d in live if is_person(d)]
    if not persons:
        return None, f"手部框{fmt_box(hand)} 中心y={hy:.0f}，但画面无人员框，无法计算腰线"
    nearest = min(persons, key=lambda p: math.hypot((p.box[0] + p.box[2]) / 2 - hx, (p.box[1] + p.box[3]) / 2 - hy))
    waist = nearest.box[1] + WAIST_RATIO * (nearest.box[3] - nearest.box[1])
    elevated = hy <= waist
    return elevated, (
        f"手部框{fmt_box(hand)} 中心y={hy:.0f} · 人体框{fmt_box(nearest)} 腰线y={waist:.0f}"
        f"（y_top+{WAIST_RATIO}*h）→ {'手部高于腰线，放行' if elevated else '手部低于腰线，阻断'}"
    )


def pipeline_track_key(rule_id: str, subject: Det, shape: tuple[int, int], index: int) -> str:
    if subject.track_id is not None:
        return f"pipe:{rule_id}:t{subject.track_id}"
    cx, cy = box_center_norm(subject, shape)
    return f"pipe:{rule_id}:{norm_class(subject.prompt)}@{int(cx // PIPE_CELL)}_{int(cy // PIPE_CELL)}"


def pipeline_suspects(sid: str, dets: list[Det], shape: tuple[int, int], st: StreamState, now: float) -> list[Suspect]:
    """逐条规则管道、逐级门禁：前置不满足直接跳过，不产生任何后续算力与 VLM 开销。"""
    pipelines = pipelines_for(sid)
    if not pipelines:
        return []
    low = RT.cfg.low
    live = [d for d in dets if passes(d, low)]
    result: list[Suspect] = []
    for pipe in pipelines:
        rule_id, name = pipe["id"], pipe["name"] or pipe["id"]
        def trace(gate: str, verdict: str, detail: str, _sid: str = sid, _rid: str = rule_id, _name: str = name) -> None:
            gate_trace(_sid, _rid, _name, gate, verdict, detail)

        pose_on = pipe["hand_pose_filter"] == "HAND_ELEVATED"
        wants_hand = any("hand" in norm_class(c) for c in pipe["subject_classes"])
        # 阶段 1：主体检查
        subjects = [d for d in live if matches_class(d, pipe["subject_classes"])]
        degraded = False
        if not subjects and pose_on and wants_hand:
            # 小模型在中远景常检不出独立手部框：退化为人员框放行，细节交二级 VLM 裁定
            persons = [d for d in live if is_person(d)]
            if persons:
                subjects = persons
                degraded = True
                trace(
                    "[Gate 1 - Subject]", "pass",
                    f"未独立检出手部框，退化使用 {len(persons)} 个 person 框作为主体（{seen_summary(persons, 3)}），交 VLM 裁定手部细节",
                )
        if not subjects:
            trace(
                "[Gate 1 - Subject]", "block",
                f"要求主体 {pipe['subject_classes']}，本帧检出（阈值≥{low:.2f}）：{seen_summary(live)}",
            )
            continue
        if not degraded:
            trace("[Gate 1 - Subject]", "pass", f"检出主体 {len(subjects)} 个：{seen_summary(subjects, 4)}")
        # 阶段 1：手部姿态（仅作用于手部类主体，其余主体不受影响）
        if pose_on:
            if degraded:
                trace("[Gate 2 - Pose]", "pass", "无独立手部框，姿态判定退化放行（不因漏检手部而短路），由 VLM 复核")
            else:
                kept: list[Det] = []
                notes: list[str] = []
                for d in subjects:
                    if not is_hand(d):
                        kept.append(d)
                        notes.append(f"{d.prompt}{fmt_box(d)} 非手部框，无需姿态判定，放行")
                        continue
                    verdict, note = hand_pose_check(d, live)
                    notes.append(note)
                    if verdict:
                        kept.append(d)
                    elif verdict is None and any(is_person(p) for p in live) is False:
                        # 无人员框无法算腰线：宁可放行交 VLM，也不静默丢弃
                        kept.append(d)
                        notes[-1] += "；无腰线参照，退化放行"
                subjects = kept
                trace("[Gate 2 - Pose]", "pass" if subjects else "block", " | ".join(notes[:3]))
                if not subjects:
                    continue
        else:
            trace("[Gate 2 - Pose]", "info", "规则未开启 HAND_ELEVATED，跳过")
        # 阶段 1：空间相交
        zone_note = ""
        if pipe["require_roi"]:
            bound = set(pipe["bound_roi_ids"])
            polygons = [
                z for z in zones_for(sid)
                if z.get("type") == "polygon" and len(z.get("coordinates") or []) >= 3 and (not bound or z["id"] in bound)
            ]
            if not polygons:
                trace(
                    "[Gate 3 - ROI]", "pass",
                    f"规则要求围栏，但通道 {sid} 无可用多边形围栏（绑定 {sorted(bound) or '全部'}），退化为全画面监测",
                )
            else:
                hit_subjects: list[Det] = []
                probes: list[str] = []
                for subject in subjects:
                    hit_name = ""
                    for zone in polygons:
                        if box_hits_polygon(subject, zone["coordinates"], shape):
                            hit_name = str(zone.get("name") or zone["id"])
                            break
                    probes.append(f"{subject.prompt}{fmt_box(subject)}→{'相交「' + hit_name + '」' if hit_name else '未相交'}")
                    if hit_name:
                        hit_subjects.append(subject)
                        zone_note = f"进入围栏「{hit_name}」"
                trace(
                    "[Gate 3 - ROI]", "pass" if hit_subjects else "block",
                    f"{len(polygons)} 个围栏：" + "；".join(probes[:3]),
                )
                subjects = hit_subjects
                if not subjects:
                    continue
        else:
            trace("[Gate 3 - ROI]", "info", "规则未要求围栏，全画面监测")
        # 阶段 2：伴生物体与接触判定
        contexts: list[Det] = []
        if pipe["require_context_object"]:
            context_roles = (ROLE_PIPE, ROLE_CONTEXT, ROLE_SUBJECT, ROLE_HAZARD)
            contexts = [d for d in live if d.role in context_roles and matches_class(d, pipe["context_classes"])]
            if not contexts:
                trace(
                    "[Gate 4 - Context]", "block",
                    f"要求伴随介质 {pipe['context_classes']}，本帧未检出；当前检出：{seen_summary(live)}",
                )
                continue
        else:
            trace("[Gate 4 - Context]", "info", "规则未要求伴随介质，跳过")
        gate4_blocks: list[str] = []
        gate4_passes: list[str] = []
        gate5_blocks: list[str] = []
        gate5_passes: list[str] = []
        for index, subject in enumerate(subjects):
            pair_conf = subject.conf
            pair_note = ""
            if pipe["require_context_object"]:
                limit = pipe["max_interaction_distance"]
                best: tuple[Det, float] | None = None
                nearest_dist: float | None = None
                scx, scy = box_center_norm(subject, shape)
                for other in contexts:
                    if other is subject:
                        continue
                    ocx, ocy = box_center_norm(other, shape)
                    dist = math.hypot(scx - ocx, scy - ocy)
                    nearest_dist = dist if nearest_dist is None else min(nearest_dist, dist)
                    if limit is not None:
                        if dist > limit and iou(subject.box, other.box) <= 0:
                            continue
                    elif proximity(subject, other) is None:
                        continue
                    if best is None or other.conf > best[0].conf:
                        best = (other, other.conf)
                if best is None:
                    limit_text = f"上限 {limit:.0f}" if limit is not None else "需框相交或靠近"
                    gate4_blocks.append(
                        f"{subject.prompt}{fmt_box(subject)} 与伴随介质最近距离 "
                        f"{'-' if nearest_dist is None else format(nearest_dist, '.0f')}（千分比坐标，{limit_text}）"
                    )
                    continue
                pair_conf = min(subject.conf, best[1])
                pair_note = f" 与 {label_of(best[0].prompt, sid)} 接触"
                gate4_passes.append(f"{subject.prompt} 与 {best[0].prompt}:{best[0].conf:.2f} 接触")
            # 阶段 4：同一主体冷却抑制（先于切片截取与送审）
            key = pipeline_track_key(rule_id, subject, shape, index)
            remaining = st.cooldown.get(key, 0.0) - now
            if remaining > 0:
                RT.stats.cooldown_suppressed += 1
                gate5_blocks.append(f"{key.split(':', 2)[-1]} 冷却剩余 {remaining:.0f}s")
                continue
            shadow = bool(pipe["enable_shadow_review"]) and pair_conf < RT.cfg.high
            gate5_passes.append(f"{key.split(':', 2)[-1]} 无冷却")
            result.append(
                Suspect(
                    key=key,
                    track_id=subject.track_id,
                    conf=round(pair_conf, 3),
                    reasons=[f"规则「{name}」门禁通过：{label_of(subject.prompt, sid)}{zone_note}{pair_note}"],
                    cooldown=pipe["track_cooldown_seconds"],
                    rule_id=rule_id,
                    shadow=shadow,
                )
            )
        if pipe["require_context_object"]:
            if gate4_passes:
                trace("[Gate 4 - Context]", "pass", "；".join(gate4_passes[:3]))
            if gate4_blocks and not gate4_passes:
                trace("[Gate 4 - Context]", "block", "；".join(gate4_blocks[:3]))
        if gate5_blocks and not gate5_passes:
            trace("[Gate 5 - Cooldown]", "block", "；".join(gate5_blocks[:3]) + f"（规则冷却 {pipe['track_cooldown_seconds']:.0f}s）")
        elif gate5_passes:
            trace("[Gate 5 - Cooldown]", "pass", "；".join(gate5_passes[:3]) + "，进入连续帧确认与切片送审")
    return result


def draw_zones(canvas: np.ndarray, zones: list[dict[str, Any]]) -> None:
    height, width = canvas.shape[:2]
    for zone in zones:
        points = np.array(
            [[int(p[0] / 100.0 * width), int(p[1] / 100.0 * height)] for p in zone.get("coordinates", [])],
            dtype=np.int32,
        )
        if len(points) < 2:
            continue
        color = (60, 60, 230)
        if zone.get("type") == "polygon" and len(points) >= 3:
            overlay = canvas.copy()
            cv2.fillPoly(overlay, [points], color)
            cv2.addWeighted(overlay, 0.18, canvas, 0.82, 0, dst=canvas)
            cv2.polylines(canvas, [points], True, color, 2, cv2.LINE_AA)
        else:
            cv2.line(canvas, tuple(points[0]), tuple(points[1]), color, 3, cv2.LINE_AA)
        cv2.putText(
            canvas, str(zone.get("name") or zone.get("id")), (int(points[0][0]) + 4, int(points[0][1]) + 16),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA,
        )


# --------------------------------------------------------------------------- #
# 标注图
# --------------------------------------------------------------------------- #
def draw(
    image: np.ndarray,
    dets: list[Det],
    header: str,
    mask: np.ndarray | None = None,
    warn: bool = False,
    zones: list[dict[str, Any]] | None = None,
    anchor: dict[str, Any] | None = None,
) -> np.ndarray:
    canvas = image.copy()
    height, width = canvas.shape[:2]
    if zones:
        draw_zones(canvas, zones)
    if anchor:
        center = (int(anchor["center"][0] / 1000 * width), int(anchor["center"][1] / 1000 * height))
        axes = (max(4, int(anchor["radius"] / 1000 * width)), max(4, int(anchor["radius"] / 1000 * height)))
        cv2.ellipse(canvas, center, axes, 0, 0, 360, (255, 200, 0), 2, cv2.LINE_AA)
        cv2.putText(canvas, "anchor", (center[0] - axes[0], max(36, center[1] - axes[1] - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 200, 0), 1, cv2.LINE_AA)
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


def draw_overlay(
    shape: tuple[int, ...],
    dets: list[Det],
    zones: list[dict[str, Any]] | None = None,
    anchor: dict[str, Any] | None = None,
) -> np.ndarray:
    """生成与画面同尺寸的透明 BGRA 图层：只含检测框 / Track ID / 电子围栏 / 记忆锚点，不含底图。"""
    height, width = shape[:2]
    canvas = np.zeros((height, width, 4), dtype=np.uint8)
    for zone in zones or []:
        points = np.array(
            [[int(p[0] / 100.0 * width), int(p[1] / 100.0 * height)] for p in zone.get("coordinates", [])],
            dtype=np.int32,
        )
        if len(points) < 2:
            continue
        color = (60, 60, 230)
        if zone.get("type") == "polygon" and len(points) >= 3:
            cv2.fillPoly(canvas, [points], (*color, 46))
            cv2.polylines(canvas, [points], True, (*color, 255), 2, cv2.LINE_AA)
        else:
            cv2.line(canvas, tuple(points[0]), tuple(points[1]), (*color, 255), 3, cv2.LINE_AA)
        cv2.putText(
            canvas, str(zone.get("name") or zone.get("id")), (int(points[0][0]) + 4, int(points[0][1]) + 16),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (*color, 255), 1, cv2.LINE_AA,
        )
    if anchor:
        center = (int(anchor["center"][0] / 1000 * width), int(anchor["center"][1] / 1000 * height))
        axes = (max(4, int(anchor["radius"] / 1000 * width)), max(4, int(anchor["radius"] / 1000 * height)))
        cv2.ellipse(canvas, center, axes, 0, 0, 360, (255, 200, 0, 255), 2, cv2.LINE_AA)
        cv2.putText(canvas, "anchor", (center[0] - axes[0], max(16, center[1] - axes[1] - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 200, 0, 255), 1, cv2.LINE_AA)
    for det in dets:
        color = (*ROLE_COLORS.get(det.role, (200, 200, 200)), 255)
        x1, y1, x2, y2 = (int(v) for v in det.box)
        cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 2)
        tag = f"#{det.track_id} " if det.track_id is not None else ""
        text = f"{tag}{det.prompt} {det.conf:.2f}"
        (tw, th), base = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        top = max(0, y1 - th - base - 4)
        cv2.rectangle(canvas, (x1, top), (x1 + tw + 6, top + th + base + 4), color, -1)
        cv2.putText(canvas, text, (x1 + 3, top + th + 2), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255, 255), 1, cv2.LINE_AA)
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
        "reasons": event["reasons"],
        "keyframesBase64": frames,
        "explore": bool(event.get("explore")),
        "hint": event.get("hint"),
        "ruleId": event.get("ruleId"),
        "shadowReview": bool(event.get("shadow")),
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
# 初筛命中日志
# --------------------------------------------------------------------------- #
def hit_tags(dets: list[Det], sid: str = "") -> list[dict[str, Any]]:
    low = RT.cfg.low
    seen: set[str] = set()
    tags: list[dict[str, Any]] = []
    for d in sorted(dets, key=lambda item: -item.conf):
        if not passes(d, low) or d.prompt in seen:
            continue
        seen.add(d.prompt)
        tags.append({"label": label_of(d.prompt, sid), "prompt": d.prompt, "role": d.role, "confidence": round(d.conf, 3)})
    return tags[:6]


def log_hit(
    st: StreamState,
    tags: list[dict[str, Any]],
    reasons: list[str],
    gate: str,
    progress: dict[str, int] | None = None,
    event_id: str | None = None,
    anchor: bool = False,
    explore: bool = False,
) -> None:
    if not tags and not reasons:
        return
    now = time.time()
    sig = f"{gate}|{event_id or ''}|{int(anchor)}{int(explore)}|" + ",".join(t["prompt"] for t in tags)
    last = st.last_entry
    if last is not None and event_id is None and st.last_entry_sig == sig and now - st.last_entry_ts < HIT_DEDUPE_SECONDS:
        last["repeat"] += 1
        last["hits"] = tags
        if progress:
            last["progress"] = progress
        st.last_entry_ts = now
        return
    entry: dict[str, Any] = {
        "id": uuid.uuid4().hex[:10],
        "at": now_iso(),
        "streamId": st.sid,
        "gate": gate,
        "hits": tags,
        "reasons": reasons[:3],
        "repeat": 1,
    }
    if progress:
        entry["progress"] = progress
    if anchor:
        entry["anchor"] = True
    if explore:
        entry["explore"] = True
    if event_id:
        entry["eventId"] = event_id
    RT.hitlog.appendleft(entry)
    st.last_entry, st.last_entry_sig, st.last_entry_ts = entry, sig, now


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

    if RT.model_state != "ready" or RT.model is None or not prompts_of(sid):
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
    dets = detect(image, st.tracker, sid)
    st.last_infer_ts = now
    RT.stats.tier1_inferred += 1
    suspects, passed, persons = evaluate(dets, sid)
    relation_keys = {s.key for s in suspects}
    for hit in anchor_suspects(sid, dets, image.shape[:2]):
        if f"rel:{hit.key[len('anchor:'):]}" not in relation_keys:
            suspects.append(hit)
    suspects.extend(explore_suspects(sid, dets, image.shape[:2], st, relation_keys))
    suspects.extend(zone_suspects(sid, dets, image.shape[:2], st.zone_side))
    suspects.extend(pipeline_suspects(sid, dets, image.shape[:2], st, now))
    st.last_had_person = persons > 0 or any(d.role == ROLE_SUBJECT and passes(d, cfg.low) for d in dets)
    st.last_persons = persons
    st.last = {"ts": now, "image": image, "dets": dets, "motion": ratio, "mask": None}

    tags = hit_tags(dets, sid)

    if not suspects:
        RT.stats.tier1_passed += 1
        st.tracks.clear()
        st.has_pending = False
        log_hit(st, tags, [], "passed")
        return

    keys = {s.key for s in suspects if not s.instant}
    for key in list(st.tracks):
        if key not in keys:
            del st.tracks[key]
    triggered: list[Suspect] = []
    pending_list: list[tuple[Suspect, int]] = []
    cooled_list: list[Suspect] = []
    for suspect in suspects:
        if suspect.instant:
            if st.cooldown.get(suspect.key, 0.0) > now:
                RT.stats.cooldown_suppressed += 1
                cooled_list.append(suspect)
            else:
                triggered.append(suspect)
            continue
        prev = st.tracks.get(suspect.key)
        hits = (prev.hits + 1) if prev else 1
        st.tracks[suspect.key] = TrackState(hits=hits, last_conf=suspect.conf, reasons=suspect.reasons)
        if hits < (suspect.min_frames or cfg.min_frames):
            pending_list.append((suspect, hits))
            if suspect.rule_id:
                gate_trace(
                    sid, suspect.rule_id, suspect.rule_id, "[Gate 6 - Debounce]", "block",
                    f"连续帧确认中 {hits}/{suspect.min_frames or cfg.min_frames}（目标 {suspect.key}），尚未升级",
                )
            continue
        if st.cooldown.get(suspect.key, 0.0) > now:
            RT.stats.cooldown_suppressed += 1
            cooled_list.append(suspect)
            continue
        triggered.append(suspect)
    st.has_pending = bool(pending_list)

    if not triggered:
        RT.stats.tier1_pending += 1
        if pending_list:
            best, hits = max(pending_list, key=lambda item: item[1])
            log_hit(
                st, tags, best.reasons, "pending", {"hits": hits, "need": best.min_frames or cfg.min_frames},
                anchor=best.anchor, explore=best.explore,
            )
        elif cooled_list:
            log_hit(st, tags, cooled_list[0].reasons, "cooldown", anchor=cooled_list[0].anchor, explore=cooled_list[0].explore)
        return

    annotated = encode_jpeg(draw(image, dets, header_text(ratio, dets), zones=zones_for(sid), anchor=anchor_of(sid)))
    frames = [base64.b64encode(raw).decode("ascii") for raw in list(st.ring)[-4:]]
    frames.append(base64.b64encode(annotated).decode("ascii"))
    for suspect in triggered:
        if suspect.cooldown is not None:
            st.cooldown[suspect.key] = now + suspect.cooldown
        else:
            st.cooldown[suspect.key] = now + (max(cfg.cooldown, EXPLORE_COOLDOWN) if suspect.explore else cfg.cooldown)
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
            "explore": suspect.explore,
            "hint": suspect.hint,
            "ruleId": suspect.rule_id,
            "shadow": suspect.shadow,
        }
        RT.events.appendleft(event)
        if suspect.rule_id:
            gate_trace(
                sid, suspect.rule_id, suspect.rule_id, "[Gate 6 - Escalate]", "pass",
                f"目标 {suspect.key} 已升级抓帧送审，事件 {event['id']}，冷却 {suspect.cooldown or cfg.cooldown:.0f}s",
            )
        log_hit(st, tags, suspect.reasons, "escalated", event_id=event["id"], anchor=suspect.anchor, explore=suspect.explore)
        PUSH_POOL.submit(push_event, event, frames)
    for key in [k for k, until in st.cooldown.items() if until < now - 60]:
        del st.cooldown[key]


def scan_loop() -> None:
    while not STOP.is_set():
        cfg = RT.cfg
        if not cfg.enabled or not cfg.stream_ids:
            STOP.wait(0.5)
            continue
        if RT.updating:
            # 词表正在后台更新：暂停推理，避免与 set_classes 争抢 model_lock / CPU
            STOP.wait(0.2)
            continue
        interval = 1.0 / effective_fps(cfg)
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
    """默认词表视图（兼容旧字段）；各通道独立词表见 /health 的 channelContexts。"""
    return [
        {"promptEn": prompt, "labelZh": RT.default_labels.get(prompt, ""), "role": RT.default_roles.get(prompt, "")}
        for prompt in RT.default_prompts
    ]


def channel_contexts_view() -> dict[str, Any]:
    return {
        sid: {
            "source": RT.channel_source.get(sid, "default"),
            "tags": [
                {"promptEn": p, "labelZh": RT.channel_labels.get(sid, {}).get(p, ""), "role": RT.channel_roles.get(sid, {}).get(p, "")}
                for p in prompts
            ],
        }
        for sid, prompts in RT.channel_model_contexts.items()
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    """async + 纯内存读取：不进线程池、不取任何锁，即使推理/词表更新占满 CPU 也能即时响应。"""
    ready = RT.model_state == "ready"
    updating = RT.updating
    streams: dict[str, Any] = {}
    now = time.time()
    for sid in RT.cfg.stream_ids:
        st = RT.streams.get(sid)
        if st is None:
            streams[sid] = {
                "online": False, "monitored": True, "frames": 0, "ringFrames": 0,
                "zones": len(zones_for(sid)), "error": "",
            }
            continue
        streams[sid] = {
            "online": bool(st.last_ok_ts) and now - st.last_ok_ts < 10 and not st.last_error,
            "monitored": True,
            "frames": st.frames,
            "ringFrames": len(st.ring),
            "zones": len(zones_for(sid)),
            "motionPct": None if st.last_motion_pct is None else round(st.last_motion_pct, 2),
            "persons": st.last_persons,
            "pendingTracks": len(st.tracks),
            "error": st.last_error,
        }
    return {
        "ok": True,
        "status": "busy_updating" if updating else RT.model_state,
        "modelState": RT.model_state,
        "updating": updating,
        "updatingForSec": round(time.time() - RT.update_started, 1) if updating else 0,
        "mode": "yolo-world+" + RT.tracker_kind if ready else "motion-only",
        "reason": RT.reason,
        "device": RT.device,
        "modelLoaded": RT.model is not None,
        "weightsPath": str(WEIGHTS_PATH),
        "weightsPresent": WEIGHTS_PATH.exists(),
        "classes": classes_view(),
        "vocabulary": display_prompts(),
        "channelContexts": channel_contexts_view(),
        "trackerKind": RT.tracker_kind,
        "stats": RT.stats.as_dict(),
        "streams": streams,
        "recentEvents": list(RT.events)[:12],
        "hitLog": list(RT.hitlog)[:40],
        "learning": {
            sid: {
                "version": item.get("version", 0),
                "policy": item.get("policy", POLICY_DUAL),
                "tags": item.get("tagCount", 0),
                "anchor": bool(item.get("anchor")),
                "phase": "mature" if item.get("anchor") else "cold",
            }
            for sid, item in RT.cfg.learning.items()
        },
        "versions": RT.versions,
        "lastReloadMs": RT.last_reload_ms,
        "uptimeSec": int(time.time() - RT.started_at),
        "enabled": RT.cfg.enabled,
        "sampleFps": RT.cfg.sample_fps,
        "effectiveFps": round(effective_fps(RT.cfg), 2),
        "cpuThrottled": effective_fps(RT.cfg) < max(0.2, RT.cfg.sample_fps) - 1e-6,
    }


@app.get("/gate-traces")
def gate_traces(streamId: str = "", ruleId: str = "", limit: int = 100) -> dict[str, Any]:
    """规则管道门禁逐级诊断（环形缓冲，新→旧）。只读内存，不取锁，随时即时返回。"""
    items = list(RT.gate_traces)
    if streamId:
        items = [t for t in items if t["streamId"] == streamId]
    if ruleId:
        items = [t for t in items if t["ruleId"] == ruleId]
    return {"count": len(items), "traces": items[: max(1, min(MAX_GATE_TRACES, limit))]}


@app.post("/stats/reset")
def reset_stats() -> dict[str, Any]:
    RT.stats.reset()
    return {"ok": True}


@app.post("/config/reload")
async def config_reload(req: ReloadRequest) -> dict[str, Any]:
    """只做毫秒级的配置解析与状态切换；词表（CLIP 文本编码）交给后台线程，请求立即返回。"""
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
        zones=[
            {
                "id": z.id,
                "name": z.name,
                "type": z.type,
                "cameraId": z.cameraId,
                "coordinates": [[float(p[0]), float(p[1])] for p in z.coordinates if len(p) == 2],
                "directional": z.directional,
            }
            for z in req.zones
            if z.type in ("polygon", "tripwire") and z.cameraId
        ],
        pipelines=[
            {
                "id": p.id,
                "name": p.name,
                "channels": [c for c in p.boundChannels if c] or ["ALL"],
                "subject_classes": [c for c in (norm_class(x) for x in p.perception_gate.subject_classes) if c],
                "require_roi": p.perception_gate.require_roi,
                "bound_roi_ids": [r for r in p.perception_gate.bound_roi_ids if r],
                "hand_pose_filter": p.perception_gate.hand_pose_filter,
                "require_context_object": p.interaction_gate.require_context_object,
                "context_classes": [c for c in (norm_class(x) for x in p.interaction_gate.context_classes) if c],
                "max_interaction_distance": (
                    min(1000.0, max(0.0, p.interaction_gate.max_interaction_distance))
                    if p.interaction_gate.max_interaction_distance is not None
                    else None
                ),
                "track_cooldown_seconds": effective_cooldown(
                    p.id,
                    p.name,
                    [*p.perception_gate.subject_classes, *p.interaction_gate.context_classes],
                    min(3600.0, max(0.0, p.throttling.track_cooldown_seconds)),
                ),
                "enable_shadow_review": p.throttling.enable_shadow_review,
            }
            for p in req.rulePipelines
            if p.perception_gate.subject_classes
        ],
    )
    def build_context(items: list[VocabItem]) -> tuple[list[str], dict[str, str], dict[str, str]]:
        prompts: list[str] = []
        roles: dict[str, str] = {}
        labels: dict[str, str] = {}
        for item in items:
            prompt = " ".join(item.promptEn.split())
            if not item.enabled or not prompt or item.role not in ROLES or prompt in roles:
                continue
            prompts.append(prompt)
            roles[prompt] = item.role
            labels[prompt] = item.labelZh
        return prompts, roles, labels

    default_prompts, default_roles, default_labels = build_context(req.vocabulary)
    channel_contexts: dict[str, list[str]] = {}
    channel_roles: dict[str, dict[str, str]] = {}
    channel_labels: dict[str, dict[str, str]] = {}
    channel_source: dict[str, str] = {}
    # 每路通道各自一份词表上下文：专属词表（没有则用默认词表）+ 该通道自己的二级反哺词条，互不串味
    for sid in dict.fromkeys([*cfg.stream_ids, *req.channelVocabulary.keys(), *req.learning.keys()]):
        own = req.channelVocabulary.get(sid)
        if own:
            prompts, roles, labels = build_context(own)
            channel_source[sid] = "channel"
        else:
            prompts, roles, labels = list(default_prompts), dict(default_roles), dict(default_labels)
            channel_source[sid] = "default"
        channel_contexts[sid], channel_roles[sid], channel_labels[sid] = prompts, roles, labels
    # 管道用到的主体/伴生类别并入对应通道词表（角色 ROLE_PIPE，不触发既有判定）；词表里已有的类别不重复添加
    for pipe in cfg.pipelines:
        wanted = [c for c in [*pipe["subject_classes"], *pipe["context_classes"]] if c and c != WILDCARD]
        if pipe["hand_pose_filter"] == "HAND_ELEVATED" and "person" not in wanted:
            # 手部姿态需要人体框算腰线，也是手部漏检时退化放行的依据
            wanted.append("person")
        targets = cfg.stream_ids if "ALL" in pipe["channels"] else [s for s in pipe["channels"] if s in channel_contexts]
        for sid in targets:
            if sid not in channel_contexts:
                channel_contexts[sid], channel_roles[sid], channel_labels[sid] = (
                    list(default_prompts), dict(default_roles), dict(default_labels),
                )
                channel_source[sid] = "default"
            prompts, roles, labels = channel_contexts[sid], channel_roles[sid], channel_labels[sid]
            lowered = {norm_class(p): p for p in prompts}
            for cls in wanted:
                if cls in lowered or (cls == "person" and ROLE_ANCHOR in roles.values()):
                    continue
                prompts.append(cls)
                roles[cls] = ROLE_PIPE
                labels[cls] = cls
                lowered[cls] = cls
    learned_conf: dict[tuple[str, str], float] = {}
    for sid, item in req.learning.items():
        tag_count = 0
        prompts, roles, labels = channel_contexts[sid], channel_roles[sid], channel_labels[sid]
        for tag in item.tags[:MAX_LEARNED_TAGS]:
            prompt = " ".join(tag.promptEn.split())
            if not prompt or tag.role not in (ROLE_SUBJECT, ROLE_CONTEXT):
                continue
            if prompt not in roles:
                prompts.append(prompt)
                roles[prompt] = tag.role
                labels[prompt] = tag.labelZh or prompt
            learned_conf[(sid, prompt)] = min(0.95, max(0.1, tag.confidence))
            tag_count += 1
        anchor = None
        if item.anchor and len(item.anchor.center) == 2:
            anchor = {
                "center": [min(1000.0, max(0.0, item.anchor.center[0])), min(1000.0, max(0.0, item.anchor.center[1]))],
                "radius": min(1000.0, max(10.0, item.anchor.radius)),
                "description": item.anchor.description,
            }
        policy = POLICY_ANCHOR if item.policy == POLICY_ANCHOR and anchor else POLICY_DUAL
        cfg.learning[sid] = {"version": item.version, "policy": policy, "anchor": anchor, "tagCount": tag_count}
    with RT.cfg_lock:
        RT.cfg = cfg
        RT.learned_conf = learned_conf
        RT.default_prompts = default_prompts
        RT.default_roles = default_roles
        RT.default_labels = default_labels
        RT.channel_model_contexts = channel_contexts
        RT.channel_roles = channel_roles
        RT.channel_labels = channel_labels
        RT.channel_source = channel_source
        for sid in list(RT.streams):
            if sid not in cfg.stream_ids:
                del RT.streams[sid]
    RT.vocab_version += 1
    if RT.model is not None:
        schedule_vocab_update()
        ok, message = True, f"配置已受理，{len(distinct_contexts())} 套词表正在后台应用"
    else:
        ok, message = False, RT.reason
    RT.last_reload_ms = round((time.perf_counter() - started) * 1000, 1)
    log(
        f"配置已受理（{RT.last_reload_ms}ms）：默认词表 {len(default_prompts)} 条 · "
        f"{len(channel_contexts)} 路独立词表上下文 · {len(cfg.stream_ids)} 路通道 · {message}"
    )
    return {
        "ok": ok,
        "reloadMs": RT.last_reload_ms,
        "message": message,
        "status": "busy_updating" if RT.updating else RT.model_state,
        "updating": RT.updating,
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
    if RT.model_state == "ready" and RT.model is not None and prompts_of(sid):
        if st.preview_tracker is None:
            st.preview_tracker = make_tracker()
        dets = detect(image, st.preview_tracker, sid)
    return {"ts": time.time(), "image": image, "dets": dets, "motion": ratio, "mask": mask, "reused": False}


@app.get("/streams/{stream_id}/annotated.jpg")
def annotated(stream_id: str) -> Response:
    view = fresh_view(stream_id)
    degraded = RT.model_state != "ready"
    canvas = draw(
        view["image"], view["dets"], header_text(view["motion"], view["dets"]),
        view.get("mask") if degraded else None, degraded, zones_for(stream_id), anchor_of(stream_id),
    )
    return Response(content=encode_jpeg(canvas), media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/streams/{stream_id}/overlay.png")
def overlay(stream_id: str) -> Response:
    """透明标注图层：前端叠在原始视频上方，没有帧 / 没有检测时仍可返回围栏与锚点。"""
    view = fresh_view(stream_id)
    layer = draw_overlay(view["image"].shape, view["dets"], zones_for(stream_id), anchor_of(stream_id))
    ok, buffer = cv2.imencode(".png", layer)
    if not ok:
        raise HTTPException(status_code=500, detail="PNG 编码失败")
    return Response(content=buffer.tobytes(), media_type="image/png", headers={"Cache-Control": "no-store"})


@app.post("/streams/{stream_id}/inspect-once")
def inspect_once(stream_id: str) -> dict[str, Any]:
    started = time.perf_counter()
    view = fresh_view(stream_id, force=True)
    dets: list[Det] = view["dets"]
    degraded = RT.model_state != "ready"
    suspects, passed, persons = evaluate(dets, stream_id) if not degraded else ([], 0, 0)
    if not degraded:
        suspects.extend(zone_suspects(stream_id, dets, view["image"].shape[:2], None))
    if degraded:
        decision = "degraded"
    elif suspects:
        decision = "suspect"
    elif persons:
        decision = "passed"
    else:
        decision = "no-target"
    canvas = draw(
        view["image"], dets, header_text(view["motion"], dets),
        view.get("mask") if degraded else None, degraded, zones_for(stream_id), anchor_of(stream_id),
    )
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
                "labelZh": labels_of(stream_id).get(d.prompt, ""),
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
