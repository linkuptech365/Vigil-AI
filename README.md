<div align="center">

**English** | [简体中文](./README_zh.md)

# Vigil-AI

**A two-tier video audit engine: lightweight edge CV perception + vision-language causal reasoning.**

Open-vocabulary detection and spatio-temporal gates run on the edge and filter out the vast majority of frames.
Only the few that matter are escalated to a VLM, which judges cause and effect and produces auditable evidence.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Worker-009688?logo=fastapi&logoColor=white)
![YOLO-World](https://img.shields.io/badge/YOLO--World-Open--Vocabulary-111F68)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![go2rtc](https://img.shields.io/badge/go2rtc-RTSP%20%7C%20WebRTC%20%7C%20MSE-00ADD8)

</div>

---

## Table of Contents

- [Why Vigil-AI](#why-vigil-ai)
- [Architecture](#architecture)
- [Feature Matrix](#feature-matrix)
- [Quick Start](#quick-start)
  - [Option A: Docker Compose (recommended for production)](#option-a-docker-compose-recommended-for-production)
  - [Option B: Local development](#option-b-local-development)
- [Configuration](#configuration)
- [Usage Guide](#usage-guide)
- [Best Practices](#best-practices)
- [API Overview](#api-overview)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Security and Compliance Disclaimer](#security-and-compliance-disclaimer)
- [License](#license)

---

## Why Vigil-AI

Sending every frame of every camera to a large model is slow and expensive; relying on a closed-set detector alone is brittle and cannot explain *why* something is a violation.

Vigil-AI splits the problem in two:

| Tier | Runs on | Question it answers | Cost per frame |
| --- | --- | --- | --- |
| **Tier-1** edge perception funnel | CPU / local GPU | "Is something *worth looking at* happening on this channel?" | Milliseconds, no tokens |
| **Tier-2** VLM causal reasoning | Cloud or on-prem VLM | "Is it really a violation, and what is the cause and effect?" | Only on escalated frames |

Rules are bound **per channel (stream ID)**, so a "cat feeding" rule configured for the second floor can never fire on the first floor.

---

## Architecture

```mermaid
flowchart LR
    subgraph Sources["Video sources"]
        NVR["NVR / IPC<br/>(RTSP main/sub stream)"]
        FILE["Local video files"]
    end

    subgraph Edge["Tier-1 · Edge perception funnel (Python worker, 127.0.0.1:1985)"]
        T0["Tier-0<br/>frame-difference filter"]
        DET["YOLO-World<br/>open-vocabulary detection"]
        TRK["ByteTrack (anchors)<br/>+ SubjectCoastingTracker"]
        G0["Gate 0<br/>dynamic confidence + weak prior"]
        G1["Gate 1<br/>subject / negative-sample suppression"]
        G2["Gate 2<br/>pose and spatial relation"]
        G3["Gate 3<br/>ROI / tripwire"]
        DB["Consecutive-hit debounce<br/>+ cooldown lock"]
        RB[("Ring buffer<br/>pre-roll frames")]
        T0 --> DET --> TRK --> G0 --> G1 --> G2 --> G3 --> DB
        DET -.-> RB
    end

    subgraph Gateway["Gateway · Next.js (:3000)"]
        API["/api/v1/*"]
        RULES["Per-channel rule library<br/>(bound by streamId)"]
        LEARN["Tier-1 learning<br/>normalizeLearnedPrompt"]
        UI["Ops dashboard + console"]
    end

    GO["go2rtc (embedded)<br/>RTSP / WebRTC / MSE"]

    subgraph Cloud["Tier-2 · VLM causal reasoning"]
        VLM["GPT-4o / GPT-6 Astra / Qwen2.5-VL<br/>or any OpenAI-compatible local VLM"]
    end

    NVR --> GO
    FILE --> GO
    GO -- "frame.jpeg" --> T0
    DB -- "key frames + annotated snapshot" --> API
    API --> RULES --> VLM
    VLM -- "verdict + causal chain" --> API
    VLM -- "new core nouns" --> LEARN -- "vocabulary feedback" --> DET
    API --> UI
    GO -- "MJPEG / snapshot proxy" --> UI
```

### Tier-1 · Edge Perception and Gate Funnel

| Stage | What it does |
| --- | --- |
| **Open-vocabulary detection** | YOLO-World (`yolov8s-worldv2`) driven by a per-channel text vocabulary. The vocabulary is hot-swapped in memory without restarting the worker and without resetting tracks. Inference runs on CPU by default (PyTorch, with an adaptive FPS budget) and uses CUDA when available. |
| **Tracking** | `ByteTrack` (via `supervision`, with an IoU fallback) assigns Track IDs to the anchor class (`person`). `SubjectCoastingTracker` covers non-person subjects whose shape changes a lot (a cat lowering its head to drink, curling up): a subject that disappears for a moment keeps its last valid box for `VIGIL_COAST_SECONDS` / `VIGIL_COAST_FRAMES`, and is dropped for good after `VIGIL_COAST_HARD_SECONDS`. |
| **Gate 0** | Dynamic confidence floors. Open-vocabulary prompts use `min(global, VIGIL_OPEN_VOCAB_CONF)`. Once a **subject** passes its own floor, **context objects** (feeder, bowl, litter box ...) are downgraded to a *weak prior* and only need `VIGIL_CONTEXT_WEAK_CONF`, so a low-scored object can no longer block a confident subject. A rescue pass re-infers at a higher resolution when nothing passes. |
| **Gate 1** | Subject presence and negative-sample suppression (known false-positive anchors are masked out). |
| **Gate 2** | Pose and spatial-relation checks: subject-to-context distance or box overlap, hand-elevated, PPE presence, and so on. |
| **Gate 3** | ROI polygons (electronic fences) and one-way tripwires. |
| **Debounce and cooldown** | Minimum consecutive hit frames, cooldown lock, a static re-check interval, and a hit-history de-duplication window (`VIGIL_HIT_DEDUPE_SECONDS`). |
| **Ring buffer** | Keeps the latest frames per channel so the escalated package contains the **pre-roll** (what led up to the trigger) as well as the trigger frame. |

Every gate decision is written to a **gate trace** (`GET /api/v1/vision/gate-traces`), including the raw top-N model output, so you can always see *why* a frame was blocked.

### Tier-2 · VLM Causal Reasoning

- **Engines**: any OpenAI-compatible endpoint, including GPT-4o, GPT-6 Astra, Qwen2.5-VL, or an on-prem VLM. Profiles are managed in the console under *Model Gateway*; secrets stay server-side.
- **Channel-level rules**: the rule library is keyed by **stream ID**, which removes cross-channel leakage. Rules support custom names, sensitivity, severity, cooldown, schedules, positive trigger prompts and **exclusion logic** (reverse causal conditions that veto a hit).
- **Tier-1 learning feedback loop**: confirmed Tier-2 verdicts can propose new Tier-1 vocabulary. Every proposal goes through `normalizeLearnedPrompt`, which strips colours, materials and shape modifiers (`yellow open-top U-shaped litter box` becomes `litter box`), keeps 1 to 3 core nouns, and never removes the permanent `person` anchor.

### Streaming and Distribution

An embedded **go2rtc** process is started, supervised and restarted by the gateway. It ingests RTSP and serves RTSP, WebRTC and MSE. The browser never talks to go2rtc directly: snapshots and MJPEG are proxied through `:3000`, so a single port is enough (works well behind Tailscale or a reverse proxy).

### Tech Stack

Next.js (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · SWR · Python 3.11 · FastAPI / Uvicorn · Ultralytics YOLO-World · supervision (ByteTrack) · OpenCV · PyTorch · go2rtc · FFmpeg · Docker

---

## Feature Matrix

| Area | Capability | Status |
| --- | --- | --- |
| Perception | Open-vocabulary detection (YOLO-World), per-channel vocabulary | Stable |
| Perception | ByteTrack anchor tracking, `SubjectCoastingTracker` for non-person subjects | Stable |
| Perception | Gate 0 to Gate 3 funnel, gate traces, raw-output diagnostics | Stable |
| Perception | Low-light enhancement, rescue pass, adaptive CPU FPS budget | Stable |
| Perception | ROI polygons and one-way tripwires | Stable |
| Reasoning | VLM verdict with causal chain, SSE streaming | Stable |
| Reasoning | Per-channel rule binding by stream ID, custom rule names, exclusion logic | Stable |
| Reasoning | Tier-1 learning loop with prompt normalisation | Stable |
| Reasoning | 60 s alert de-duplication window and cross-camera clustering | Stable |
| Streaming | Embedded go2rtc, RTSP / WebRTC / MSE, same-origin MJPEG and snapshot proxy | Stable |
| Operations | Hit-history drawer, manual multi-frame review, alert confirmation | Stable |
| Operations | SHA-256 verified evidence package (ZIP) | Stable |
| Deployment | Docker image with the vision environment baked in (zero cold start) | Stable |
| Acceleration | OpenVINO export for Intel CPUs | Planned |

---

## Quick Start

### Option A: Docker Compose (recommended for production)

The image is built in four stages (`deps`, `builder`, `vision`, `runner`) and runs as the non-root user `nextjs`. The vision stage bakes Python 3.11, PyTorch (CPU by default), Ultralytics, the CLIP text encoder and the `yolov8s-worldv2.pt` weights into the image, so the container performs **no `pip install` and no model download at start-up**.

**1. Prepare configuration**

```bash
git clone https://github.com/linkuptech365/Vigil-AI.git
cd Vigil-AI
cp .env.example .env        # every value has a safe default; set VIGIL_EDGE_TOKEN for production
mkdir -p videos             # optional: put offline recordings here

# Initialise data configuration files (runtime data is git-ignored; only *.example.json ships)
cp data/models.example.json data/models.json
cp data/streams.example.json data/streams.json
```

> **Docker note.** `data/` is excluded by `.dockerignore` and the container keeps its state in the `vigil_data` volume (`/app/data`), so the two `cp` commands above only matter for local development. In Docker, add models and streams from the console (*Core Settings*) after start-up; the files are created inside the volume. To seed the volume instead, run `docker cp data/models.json vigil-ai:/app/data/models.json` (and `streams.json`) after the first start, then `docker compose restart vigil-ai`.

**2. `docker-compose.yml`** (shipped in the repository)

```yaml
services:
  vigil-ai:
    build:
      context: .
      dockerfile: Dockerfile
    image: vigil-ai:latest
    container_name: vigil-ai
    ports:
      - "3000:3000"            # gateway + UI + same-origin stream proxy
    environment:
      NODE_ENV: production
      PORT: "3000"
      VIGIL_ALLOWED_ROOTS: /data/videos:/tmp
      VIGIL_DATA_DIR: /app/data
    env_file:
      - path: .env
        required: false
    volumes:
      - ./videos:/data/videos      # offline recordings
      - vigil_storage:/tmp/vigil-test
      - vigil_data:/app/data       # rules, streams, models, alerts, evidence
    restart: unless-stopped

volumes:
  vigil_storage:
  vigil_data:
```

> **About ports 1984 and 1985.** go2rtc (`127.0.0.1:1984`, RTSP `8554`, WebRTC `8555`) and the vision worker (`127.0.0.1:1985`) deliberately bind to the loopback interface inside the container and are reached only through the gateway. Publishing them with `-p 1984:1984 -p 1985:1985` would not work and would not be safe. Only `3000` needs to be published.

> **Model weights.** To mount your own weights, add `- ./models:/app/models` and set `VIGIL_MODELS_DIR=/app/models` (the file must be named `yolov8s-worldv2.pt`). By default the baked-in copy under `/opt/vigil-vision/models` is used.
>
> **GPU hosts.** Build a CUDA image with `docker build --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124 -t vigil-ai:latest .`

**3. Start, probe, operate**

```bash
docker compose up -d --build          # first build downloads PyTorch, CLIP and weights

# Health probes
curl http://localhost:3000/api/v1/health      # gateway: {"status":"healthy", ...}
curl http://localhost:3000/api/v1/streams     # stream list + embedded engine status
docker exec vigil-ai node -e "fetch('http://127.0.0.1:1985/health').then(r=>r.text()).then(console.log)"   # vision worker

# Logs / restart / stop
docker compose logs -f vigil-ai
docker compose restart vigil-ai
docker compose down                   # add -v to also delete the data volumes
```

The image ships a `HEALTHCHECK` against `/api/v1/health`; `docker ps` shows `healthy` once the gateway is up.

**4. Install the streaming engine (first run only)**

The `go2rtc` binary is not part of the image. Open the console, go to *Core Settings > Streams* and click **Install engine**, or run:

```bash
docker exec vigil-ai node scripts/setup-go2rtc.mjs
```

The binary is stored in `/app/bin` of the container. For fully offline hosts, set `GO2RTC_BIN` to a mounted binary instead.

Then open <http://localhost:3000>.

### Option B: Local development

**Requirements:** Node.js >= 20, pnpm, Python 3.11 (3.9+ is tolerated), FFmpeg (a static build is bundled through `ffmpeg-static`), and access to `fonts.googleapis.com` at build time.

**1. Frontend and API gateway**

```bash
pnpm install

# Initialise data configuration files (first run only; real data stays git-ignored)
cp data/models.example.json data/models.json
cp data/streams.example.json data/streams.json
# Windows PowerShell: Copy-Item data/models.example.json data/models.json

pnpm dev                    # http://localhost:3000
```

> The example files contain placeholders only. Put real model keys and camera credentials in `data/models.json` / `data/streams.json` (or add them in the console); both files are ignored by Git and must never be committed.

Useful scripts:

```bash
pnpm typecheck              # tsc --noEmit
pnpm lint
pnpm build && pnpm start    # production build
```

**2. Python vision worker**

The gateway starts and supervises the worker for you, as long as a Python environment is available. The easiest way is the bundled installer:

```bash
pnpm setup:vision           # creates the venv, installs dependencies, downloads weights
# flags:  --cpu | --gpu | --light | --uv | --skip-weights
```

To do it by hand:

```bash
cd services/vision-worker
python3.11 -m venv .venv
source .venv/bin/activate                     # Windows: .venv\Scripts\activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
pip install ftfy regex https://github.com/ultralytics/CLIP/archive/refs/heads/main.zip

# Optional: run the worker on its own for debugging (the gateway normally does this)
VIGIL_VISION_PORT=1985 VIGIL_EDGE_TOKEN=dev-token python main.py
```

> **Weights.** `yolov8s-worldv2.pt` is downloaded automatically by Ultralytics the first time the worker loads the model (and by `pnpm setup:vision`). It is stored in `./models` (override with `VIGIL_MODELS_DIR`). Without PyTorch, weights or the CLIP encoder, the worker still starts in a **degraded motion-only mode** and reports the reason in the console instead of failing.

**3. go2rtc streaming gateway**

```bash
pnpm setup:engine           # downloads the right single-file binary into ./bin
```

The gateway generates `data/go2rtc.yaml` and manages the process, so you do not edit it by hand:

```yaml
# generated, do not edit
api:    { listen: "127.0.0.1:1984" }
rtsp:   { listen: "127.0.0.1:8554" }
webrtc: { listen: "127.0.0.1:8555" }
ffmpeg: { bin: "<ffmpeg-static path>" }
log:    { level: warn }
streams: {}                  # filled from data/streams.json
```

Already have a binary? Point `GO2RTC_BIN` at it. Manual download: <https://github.com/AlexxIT/go2rtc/releases>.

---

## Configuration

Copy [`.env.example`](./.env.example) to `.env`. Highlights:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Gateway port |
| `VIGIL_DATA_DIR` | `<cwd>/data` | Persistent data (`rules.json`, `streams.json`, `models.json`, alerts, evidence) |
| `VIGIL_ALLOWED_ROOTS` | `/data/videos:/tmp:/tmp/vigil-test` | Directory allow-list for file scanning and frame extraction |
| `VIGIL_EDGE_TOKEN` | empty | Bearer token for worker-to-gateway callbacks. **Set it in production.** |
| `VIGIL_EVIDENCE_RETENTION_DAYS` | `365` | Evidence retention |
| `VIGIL_VISION_PORT` | `1985` | Worker port (loopback only) |
| `VIGIL_OPEN_VOCAB_CONF` | `0.30` | Gate 0: floor for open-vocabulary prompts |
| `VIGIL_CONTEXT_WEAK_CONF` | `0.10` | Gate 0: weak-prior floor for context objects |
| `VIGIL_RESCUE_CONF` | `0.15` | Gate 0: relaxed floor for the rescue pass (0 disables) |
| `VIGIL_COAST_SECONDS` / `_FRAMES` / `_HARD_SECONDS` | `1.5` / `3` / `6.0` | Subject coasting window |
| `VIGIL_HIT_DEDUPE_SECONDS` | `8` | Hit-history de-duplication window |
| `VIGIL_CPU_MAX_FPS` | `3` | Total CPU inference FPS budget |
| `ENABLE_STREAM_PATROL` | `false` | Server-side auto patrol (consumes VLM tokens when on) |
| `VIGIL_DISABLE_VISION_ENGINE` / `VIGIL_DISABLE_STREAM_ENGINE` | empty | Set to `1` to disable the worker / go2rtc |

> **LLM credentials are not environment variables.** `OPENAI_API_KEY`, `AZURE_OPENAI_*` and similar are **not read**. Add your provider in the console under *Model Gateway*: choose the provider, set **Base URL**, **API key** and **model name** (for example `gpt-4o`), and mark it as default. Profiles are persisted in `data/models.json` (mode 600) and only masked keys are returned by the API. Use *Test connection* to verify RTT and model discovery.

All endpoints that take a physical path reject null bytes and `..`, resolve symlinks, and require the result to be inside the allow-list.

---

## Usage Guide

### Step 1: Add a video stream

Open the console, go to *Core Settings > Streams*, and add a channel:

| Field | Example |
| --- | --- |
| Name | `一楼` / `2楼` (any human-friendly name; this is the **only** label shown anywhere in the UI) |
| Zone | `Lobby` |
| Source | `rtsp://admin:password@192.168.1.64:554/Streaming/Channels/102` |

Common RTSP URL patterns:

| Vendor | Main stream | Sub stream (recommended for AI) |
| --- | --- | --- |
| Hikvision | `rtsp://user:pass@IP:554/Streaming/Channels/101` | `.../Streaming/Channels/102` |
| Dahua | `rtsp://user:pass@IP:554/cam/realmonitor?channel=1&subtype=0` | `...&subtype=1` |
| Generic NVR (ONVIF) | `rtsp://user:pass@IP:554/<vendor path>` | same |

Use the **sub stream** for detection (lower resolution, lower CPU) and keep the main stream for evidence if your NVR allows it. The stream's generated ID is an internal key; rules, hits and alerts are always bound to that ID and displayed by name, so renaming a stream never breaks a rule.

### Step 2: Configure the per-channel perception vocabulary

Each channel has its own Tier-1 vocabulary. Every entry has an English prompt (for YOLO-World) and a role:

| Role | ID | Meaning | Example |
| --- | --- | --- | --- |
| Anchor | `anchor_person` (`ROLE_ANCHOR`) | The person; gets a Track ID via ByteTrack. Always present. | `person` |
| Subject | `subject_target` (`ROLE_SUBJECT`) | The initiator of the behaviour. Non-person subjects are protected by the coasting tracker. | `cat`, `dog` |
| Context | `context_object` (`ROLE_CONTEXT`) | The object or place the behaviour happens at. **Never triggers on its own**; acts as a weak prior. | `pet feeder`, `water dispenser`, `cat litter box` |
| PPE / Hazard | `required_ppe`, `hazard_target` | Required equipment / dangerous objects | `hard hat`, `lighter` |

Prompt rules that keep CLIP embeddings stable:

- Use **1 to 3 core nouns**: `cat`, `pet feeder`, `water dispenser`, `cat litter box`.
- **Do not** add colours, materials, shapes or sizes: avoid `yellow open-top U-shaped entry litter box`.
- Keep the list short (a handful of entries per channel). Long vocabularies dilute the score of every entry.
- Pick the subject first, then add only the context objects the rule really needs.

### Step 3: Define VLM semantic rules

Create a rule in *Rules and Debounce*:

1. **Name**: edit inline on the card; changes propagate to alerts and dashboards immediately.
2. **Positive trigger prompt**: describe what must be true. *"A cat is eating from the feeder or drinking at the water dispenser."*
3. **Exclusion logic**: describe the causal chains that must veto the hit. *"A person is refilling the bowl"*, *"the cat only walks past"*.
4. **Bound channels**: tick the specific channels (shown by name). `All sources` is mutually exclusive with individual channels, so a rule can never be half-global.
5. **Sensitivity, severity, cooldown, schedule**: tune per rule. The default cooldown window is 60 s per channel and rule.

### Step 4: Closed-loop audit and alert handling

- **Hit-history drawer**: every Tier-1 hit with its annotated frame, gate trace and verdict.
- **Manual escalation**: select a hit (or a multi-frame pre-roll slice) and send it to Tier-2 on demand.
- **Alert stream**: confirm, dismiss or escalate alerts with one click; duplicates inside the cooldown window are folded into the existing case.
- **Evidence package**: export a ZIP with key frames, `manifest.json` and SHA-256 checksums for audit trails.

---

## Best Practices

- **One vocabulary per scene.** Do not copy a vocabulary across channels; the second floor needs `cat`, the first floor needs `person`.
- **Check Gate 0 first when a detection is missing.** Open the gate trace: the raw-output line tells you which prompt scored what and which floor blocked it.
- **Tune floors with the environment, not by hand-editing prompts.** Lower `VIGIL_OPEN_VOCAB_CONF` for hard subjects (e.g. 0.25) before adding more prompts.
- **Use the sub stream** for Tier-1 and set `VIGIL_CPU_MAX_FPS` to what your CPU can sustain.
- **Protect the callback endpoints** with `VIGIL_EDGE_TOKEN` and keep `3000` behind HTTPS.
- **Keep `ENABLE_STREAM_PATROL` off** unless you explicitly want scheduled VLM calls.
- **Back up the `vigil_data` volume**; it holds rules, streams, model profiles and evidence.

---

## API Overview

All endpoints live under `/api/v1`. See [`docs/项目说明.md`](./docs/项目说明.md) for the full list (Chinese).

| Area | Endpoints |
| --- | --- |
| Health | `GET /health`, `POST /test-connection` |
| Streams | `GET/POST /streams`, `GET/PATCH/DELETE /streams/{id}`, `/streams/{id}/snapshot`, `/mjpeg`, `/annotated`, `/analyze`, `/test`, `/streams/engine` |
| Vision (Tier-1) | `GET /vision/engine`, `GET/PUT /vision/config`, `GET/PUT /vision/channel-config`, `GET /vision/gate-traces`, `GET /vision/hits`, `GET /vision/learning`, `GET/PUT /roi-zones` |
| Reasoning (Tier-2) | `POST /vlm/analyze` (SSE), `POST /incident/trigger` (edge escalation) |
| Rules | `GET/POST /rules`, `PATCH/DELETE /rules/{id}`, `/rules/evaluate`, `/rules/suppress`, `/rules/simulate-storm`, `/rules/cluster` |
| Models | `GET/POST /models`, `PATCH/DELETE /models/{id}`, `POST /models/{id}/default` |
| Alerts | `GET /stream-alerts`, `GET/PATCH /stream-alerts/{alertId}`, `/archive`, `/frames/{index}` |

```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/streams
curl -X PATCH http://localhost:3000/api/v1/rules/RULE-04 \
  -H "content-type: application/json" -d '{"name":"Fire and smoke warning"}'
```

---

## Project Structure

```text
app/                    Next.js App Router (UI + /api/v1 gateway)
components/ops/         Ops dashboard: matrix, perception, rules, alerts
components/vigil/       Console: streams, vocabulary, model gateway
lib/ops/                Rule types, client helpers, rule binding
lib/ops/server/         Rule engine, VLM adapters, vision compiler, Tier-1 feedback
lib/vigil/              Vision config, vocabulary, Tier-1 learning
lib/storage/            File-backed stores (rules, streams, alerts, evidence)
lib/stream-engine.ts    go2rtc supervisor
lib/vision-engine.ts    Python worker supervisor and proxy
services/vision-worker/ FastAPI worker: YOLO-World, ByteTrack, gates
scripts/                setup-vision.mjs, setup-go2rtc.mjs
Dockerfile              Four-stage production image
docker-compose.yml      Single-service stack
```

---

## Roadmap

- OpenVINO export path for Intel CPUs (the current worker runs PyTorch on CPU or CUDA).
- Pluggable local VLM runners with per-channel routing.
- Prometheus metrics for gate pass rates and Tier-2 spend.

---

## Contributing

Contributions are welcome.

1. **Open an issue first** for anything non-trivial. For bugs include: version / commit, deployment mode (Docker or local), the relevant **gate trace**, a screenshot, and steps to reproduce. For feature requests describe the scene and the expected behaviour.
2. **Fork and branch** from `main`: `feat/<topic>` or `fix/<topic>`.
3. **Code style**: TypeScript strict mode, Prettier (`pnpm format`), ESLint (`pnpm lint`). Python follows PEP 8 with type hints. UI uses the existing shadcn/ui components and design tokens; do not hard-code colours.
4. **Verify** before pushing: `pnpm typecheck` and `pnpm lint` must pass. For worker changes run `python -m py_compile services/vision-worker/main.py`.
5. **Open a pull request** with a clear description, linked issue and screenshots for UI changes. Keep PRs focused; one concern per PR.
6. By contributing you agree that your work is licensed under Apache 2.0.

---

## Security and Compliance Disclaimer

Vigil-AI is an **AI-assisted video analysis tool**. Its outputs are probabilistic, can be wrong, and must be reviewed by a qualified human before any disciplinary, legal or safety-critical decision is taken.

Operators are solely responsible for complying with the surveillance, privacy, labour and data-protection laws that apply where the cameras are installed (for example GDPR, CCPA, PIPL), including notice and consent, purpose limitation, retention limits and access control. Do not use this software for covert surveillance, biometric identification without a legal basis, or any unlawful purpose.

Frames sent to a Tier-2 VLM leave your network when you use a hosted model. Use an on-prem model if footage must not leave the site.

The software is provided "AS IS" without warranty of any kind (see the license).

To report a security vulnerability, please open a private security advisory on GitHub instead of a public issue.

---

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).

Copyright (c) 2026 Vigil-AI Authors / Qianze Blueprint Group & Linkup Tech.

See [`NOTICE`](./NOTICE) for third-party components. Note that Ultralytics YOLO-World is distributed under AGPL-3.0 (or a commercial Enterprise License); you are responsible for complying with it in your own deployment.
