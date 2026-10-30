<div align="center">

[English](./README.md) | **简体中文**

# Vigil-AI

**两级视频稽查引擎：轻量边缘视觉感知 + 视觉语言大模型因果推理。**

边缘端用开放词汇检测与时空门禁挡掉绝大多数无效画面，只把真正有价值的少量关键帧送给大模型做因果研判，并留存可审计的证据。

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

## 目录

- [为什么需要 Vigil-AI](#为什么需要-vigil-ai)
- [系统架构](#系统架构)
- [功能矩阵](#功能矩阵)
- [快速开始](#快速开始)
  - [方式 A：Docker Compose（推荐生产部署）](#方式-adocker-compose推荐生产部署)
  - [方式 B：本地开发](#方式-b本地开发)
- [配置说明](#配置说明)
- [使用指南](#使用指南)
- [最佳实践](#最佳实践)
- [接口概览](#接口概览)
- [目录结构](#目录结构)
- [路线图](#路线图)
- [参与贡献](#参与贡献)
- [安全与合规声明](#安全与合规声明)
- [开源协议](#开源协议)

---

## 为什么需要 Vigil-AI

把每一路摄像头的每一帧都送给大模型，既慢又贵；只靠封闭类别的检测器，又脆弱，而且解释不了“为什么算违规”。

Vigil-AI 把问题拆成两级：

| 层级 | 运行位置 | 回答的问题 | 单帧成本 |
| --- | --- | --- | --- |
| **一级** 边缘感知漏斗 | CPU / 本地 GPU | “这一路画面里，是否发生了**值得看**的事？” | 毫秒级，不消耗 Token |
| **二级** VLM 因果推理 | 云端或私有化大模型 | “它是不是真违规？前因后果是什么？” | 仅对送审帧计费 |

规则**按通道（streamId）绑定**：为 2 楼配置的“猫进食”规则，不会在 1 楼触发。

---

## 系统架构

```mermaid
flowchart LR
    subgraph Sources["视频源"]
        NVR["NVR / IPC<br/>(RTSP 主/子码流)"]
        FILE["本地视频文件"]
    end

    subgraph Edge["一级 · 边缘感知漏斗（Python Worker，127.0.0.1:1985）"]
        T0["Tier-0<br/>帧差预筛"]
        DET["YOLO-World<br/>开放词汇检测"]
        TRK["ByteTrack（锚点）<br/>+ SubjectCoastingTracker"]
        G0["Gate 0<br/>动态置信度 + 弱先验"]
        G1["Gate 1<br/>主体 / 负样本抑制"]
        G2["Gate 2<br/>姿态与空间关系"]
        G3["Gate 3<br/>ROI / 绊线"]
        DB["连续命中防抖<br/>+ 冷却锁"]
        RB[("环形缓冲<br/>预录帧")]
        T0 --> DET --> TRK --> G0 --> G1 --> G2 --> G3 --> DB
        DET -.-> RB
    end

    subgraph Gateway["网关 · Next.js（:3000）"]
        API["/api/v1/*"]
        RULES["通道级规则库<br/>（按 streamId 绑定）"]
        LEARN["一级词条反哺<br/>normalizeLearnedPrompt"]
        UI["作业大屏 + 配置中心"]
    end

    GO["go2rtc（内嵌）<br/>RTSP / WebRTC / MSE"]

    subgraph Cloud["二级 · VLM 因果推理"]
        VLM["GPT-4o / GPT-6 Astra / Qwen2.5-VL<br/>或任意 OpenAI 兼容的本地 VLM"]
    end

    NVR --> GO
    FILE --> GO
    GO -- "frame.jpeg" --> T0
    DB -- "关键帧 + 带框快照" --> API
    API --> RULES --> VLM
    VLM -- "研判结论 + 因果链" --> API
    VLM -- "新的核心名词" --> LEARN -- "词条反哺" --> DET
    API --> UI
    GO -- "MJPEG / 抓图代理" --> UI
```

### 一级 · 边缘感知与门禁漏斗

| 阶段 | 说明 |
| --- | --- |
| **开放词汇检测** | YOLO-World（`yolov8s-worldv2`），由各通道自己的文本词表驱动。词表在内存中热切换，不重启 Worker，也不重置轨迹。默认用 CPU 推理（PyTorch，带自适应帧率预算），有 CUDA 时自动使用。 |
| **目标追踪** | `ByteTrack`（基于 `supervision`，不可用时降级为 IoU 贪心匹配）为锚点类别（`person`）分配 Track ID。`SubjectCoastingTracker` 负责非人员主体：猫低头饮水、蜷缩等体态剧烈变化时容易单帧漏检，此时在 `VIGIL_COAST_SECONDS` / `VIGIL_COAST_FRAMES` 内沿用上一次有效框，超过 `VIGIL_COAST_HARD_SECONDS` 则彻底丢弃。 |
| **Gate 0** | 动态置信度门槛。开放词汇词条使用 `min(全局, VIGIL_OPEN_VOCAB_CONF)`。**行为主体**通过自身门槛后，**关联客体**（喂食器、食盆、猫砂盆等）降级为*弱先验*，只需达到 `VIGIL_CONTEXT_WEAK_CONF`，低分客体不会再把高置信主体一并拦住。整帧都没有词条通过时，会用更高分辨率补救推理一次。 |
| **Gate 1** | 主体存在性与负样本抑制（已知误报锚点会被屏蔽）。 |
| **Gate 2** | 姿态与空间关系：主体与客体的距离或框重叠、手部抬起、PPE 是否在位等。 |
| **Gate 3** | ROI 多边形（电子围栏）与单向绊线。 |
| **防抖与冷却** | 最少连续命中帧数、冷却锁、静止复查间隔，以及命中记录去重窗口（`VIGIL_HIT_DEDUPE_SECONDS`）。 |
| **环形缓冲** | 每个通道保留最近若干帧，送审包里既有触发帧，也有**预录帧**（触发之前发生了什么）。 |

每一次门禁判定都会写入**门禁追踪**（`GET /api/v1/vision/gate-traces`），并附带模型原始输出的 Top-N，所以任何一帧被拦截的原因都可以查到。

### 二级 · VLM 因果推理

- **引擎**：任意 OpenAI 兼容接口，包括 GPT-4o、GPT-6 Astra、Qwen2.5-VL 或私有化部署的 VLM。在配置中心的「模型网关」维护档案，密钥只保存在服务端。
- **通道级规则**：规则库以 **streamId** 为键，彻底杜绝跨通道串台。规则支持自定义名称、灵敏度、严重度、冷却、生效时段、正向触发提示词和**排除逻辑**（反向因果条件，一旦成立就否决本次命中）。
- **一级词条反哺**：二级确认过的结论可以为一级补充新词条。所有候选词都会经过 `normalizeLearnedPrompt`：去掉颜色、材质、形状等长定语（`yellow open-top U-shaped litter box` 会被收敛为 `litter box`），只保留 1 至 3 个核心名词，且永远保留 `person` 锚点。

### 流媒体分发

网关会自动拉起、守护并在异常退出时重启内嵌的 **go2rtc**：接入 RTSP，输出 RTSP、WebRTC 与 MSE。浏览器从不直连 go2rtc，抓图与 MJPEG 都经 `:3000` 同源代理，因此只需开放一个端口（配合 Tailscale 或反向代理很方便）。

### 技术栈

Next.js（App Router）· React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · SWR · Python 3.11 · FastAPI / Uvicorn · Ultralytics YOLO-World · supervision（ByteTrack）· OpenCV · PyTorch · go2rtc · FFmpeg · Docker

---

## 功能矩阵

| 领域 | 能力 | 状态 |
| --- | --- | --- |
| 感知 | 开放词汇检测（YOLO-World）、通道级词表 | 稳定 |
| 感知 | ByteTrack 锚点追踪、非人员主体的 `SubjectCoastingTracker` | 稳定 |
| 感知 | Gate 0 至 Gate 3 漏斗、门禁追踪、原始输出诊断 | 稳定 |
| 感知 | 低照度增强、补救重推理、自适应 CPU 帧率预算 | 稳定 |
| 感知 | ROI 多边形与单向绊线 | 稳定 |
| 研判 | VLM 结论与因果链、SSE 流式输出 | 稳定 |
| 研判 | 规则按 streamId 绑定通道、自定义规则名称、排除逻辑 | 稳定 |
| 研判 | 一级词条反哺与词条规范化 | 稳定 |
| 研判 | 60 秒告警去重窗口与跨摄像头聚合 | 稳定 |
| 流媒体 | 内嵌 go2rtc、RTSP / WebRTC / MSE、同源 MJPEG 与抓图代理 | 稳定 |
| 运营 | 命中记录抽屉、人工多帧送审、告警确认 | 稳定 |
| 运营 | SHA-256 校验的证据包（ZIP） | 稳定 |
| 部署 | 视觉环境固化在镜像内（零冷启动下载） | 稳定 |
| 加速 | OpenVINO 导出（Intel CPU） | 规划中 |

---

## 快速开始

### 方式 A：Docker Compose（推荐生产部署）

镜像分四个阶段构建（`deps`、`builder`、`vision`、`runner`），以非 root 用户 `nextjs` 运行。`vision` 阶段把 Python 3.11、PyTorch（默认 CPU 版）、Ultralytics、CLIP 文本编码器和 `yolov8s-worldv2.pt` 权重全部固化进镜像，容器启动时**不会再执行 `pip install`，也不会再下载模型**。

**1. 准备配置**

```bash
git clone https://github.com/linkuptech365/Vigil-AI.git
cd Vigil-AI
cp .env.example .env        # 每一项都有安全的默认值；生产环境请设置 VIGIL_EDGE_TOKEN
mkdir -p videos             # 可选：存放离线录像

# 初始化数据配置文件（运行时数据已被 .gitignore 忽略，仓库只提供 *.example.json 模板）
cp data/models.example.json data/models.json
cp data/streams.example.json data/streams.json
```

> **Docker 说明。** `.dockerignore` 已排除 `data/`，容器的状态保存在 `vigil_data` 数据卷（`/app/data`）中，因此上面两条 `cp` 主要用于本地开发。使用 Docker 时，启动后直接在控制台「系统核心配置」中添加模型与视频流即可，文件会在数据卷内自动生成。如需用模板预置数据卷，首次启动后执行 `docker cp data/models.json vigil-ai:/app/data/models.json`（`streams.json` 同理），再 `docker compose restart vigil-ai`。

**2. `docker-compose.yml`**（仓库内已提供）

```yaml
services:
  vigil-ai:
    build:
      context: .
      dockerfile: Dockerfile
    image: vigil-ai:latest
    container_name: vigil-ai
    ports:
      - "3000:3000"            # 网关 + 界面 + 同源流代理
    environment:
      NODE_ENV: production
      PORT: "3000"
      VIGIL_ALLOWED_ROOTS: /data/videos:/tmp
      VIGIL_DATA_DIR: /app/data
    env_file:
      - path: .env
        required: false
    volumes:
      - ./videos:/data/videos      # 离线录像
      - vigil_storage:/tmp/vigil-test
      - vigil_data:/app/data       # 规则、视频流、模型档案、告警、证据
    restart: unless-stopped

volumes:
  vigil_storage:
  vigil_data:
```

> **关于 1984 与 1985 端口。** go2rtc（`127.0.0.1:1984`，RTSP `8554`，WebRTC `8555`）与视觉 Worker（`127.0.0.1:1985`）在容器内特意只绑定回环地址，只能通过网关访问。用 `-p 1984:1984 -p 1985:1985` 发布它们既不会生效，也不安全。**只需要发布 `3000`。**

> **模型权重。** 如需挂载自己的权重，添加 `- ./models:/app/models` 并设置 `VIGIL_MODELS_DIR=/app/models`（文件名必须是 `yolov8s-worldv2.pt`）。默认使用镜像内 `/opt/vigil-vision/models` 的固化副本。
>
> **GPU 主机。** 用 `docker build --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124 -t vigil-ai:latest .` 构建 CUDA 版镜像。

**3. 启动、探活与日常运维**

```bash
docker compose up -d --build          # 首次构建会下载 PyTorch、CLIP 与权重

# 健康检查
curl http://localhost:3000/api/v1/health      # 网关：{"status":"healthy", ...}
curl http://localhost:3000/api/v1/streams     # 视频流列表 + 内嵌引擎状态
docker exec vigil-ai node -e "fetch('http://127.0.0.1:1985/health').then(r=>r.text()).then(console.log)"   # 视觉 Worker

# 日志 / 重启 / 停止
docker compose logs -f vigil-ai
docker compose restart vigil-ai
docker compose down                   # 加 -v 会连同数据卷一起删除
```

镜像自带针对 `/api/v1/health` 的 `HEALTHCHECK`，网关就绪后 `docker ps` 会显示 `healthy`。

**4. 安装流媒体引擎（仅首次）**

`go2rtc` 二进制不随镜像分发。打开配置中心，进入「系统核心配置 > 视频流」，点击**一键安装引擎**，或执行：

```bash
docker exec vigil-ai node scripts/setup-go2rtc.mjs
```

二进制保存在容器的 `/app/bin`。完全离线的主机请改为挂载二进制，并用 `GO2RTC_BIN` 指向它。

然后访问 <http://localhost:3000>。

### 方式 B：本地开发

**环境要求：** Node.js >= 20、pnpm、Python 3.11（3.9 以上可用）、FFmpeg（已通过 `ffmpeg-static` 内置静态版本），构建时需要能访问 `fonts.googleapis.com`。

**1. 前端与 API 网关**

```bash
pnpm install

# 初始化数据配置文件（仅首次；真实数据已被 Git 忽略）
cp data/models.example.json data/models.json
cp data/streams.example.json data/streams.json
# Windows PowerShell：Copy-Item data/models.example.json data/models.json

pnpm dev                    # http://localhost:3000
```

> 示例文件只含占位符。真实的模型密钥与摄像头凭据请写入 `data/models.json` / `data/streams.json`（或直接在控制台添加）；这两个文件已被 Git 忽略，切勿提交。

常用脚本：

```bash
pnpm typecheck              # tsc --noEmit
pnpm lint
pnpm build && pnpm start    # 生产构建
```

**2. Python 视觉 Worker**

只要有可用的 Python 环境，网关就会自动拉起并守护 Worker。最省事的方式是使用内置安装器：

```bash
pnpm setup:vision           # 创建虚拟环境、安装依赖、下载权重
# 可选参数：--cpu | --gpu | --light | --uv | --skip-weights
```

手动安装：

```bash
cd services/vision-worker
python3.11 -m venv .venv
source .venv/bin/activate                     # Windows：.venv\Scripts\activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
pip install ftfy regex https://github.com/ultralytics/CLIP/archive/refs/heads/main.zip

# 可选：单独运行 Worker 便于调试（正常由网关自动拉起）
VIGIL_VISION_PORT=1985 VIGIL_EDGE_TOKEN=dev-token python main.py
```

> **权重。** `yolov8s-worldv2.pt` 会在 Worker 首次加载模型时由 Ultralytics 自动下载（`pnpm setup:vision` 也会下载），保存到 `./models`（可用 `VIGIL_MODELS_DIR` 修改）。若缺少 PyTorch、权重或 CLIP 编码器，Worker 仍会以**降级的纯帧差模式**启动，并在控制台如实给出原因，而不是直接崩溃。

**3. go2rtc 流媒体网关**

```bash
pnpm setup:engine           # 下载对应平台的单文件二进制到 ./bin
```

网关会自动生成并托管 `data/go2rtc.yaml`，无需手工编辑：

```yaml
# 自动生成，请勿手工编辑
api:    { listen: "127.0.0.1:1984" }
rtsp:   { listen: "127.0.0.1:8554" }
webrtc: { listen: "127.0.0.1:8555" }
ffmpeg: { bin: "<ffmpeg-static 路径>" }
log:    { level: warn }
streams: {}                  # 由 data/streams.json 填充
```

已有二进制？用 `GO2RTC_BIN` 指向它即可。手动下载地址：<https://github.com/AlexxIT/go2rtc/releases>。

---

## 配置说明

把 [`.env.example`](./.env.example) 复制为 `.env`。主要配置项：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PORT` | `3000` | 网关端口 |
| `VIGIL_DATA_DIR` | `<cwd>/data` | 持久化目录（`rules.json`、`streams.json`、`models.json`、告警、证据） |
| `VIGIL_ALLOWED_ROOTS` | `/data/videos:/tmp:/tmp/vigil-test` | 文件扫描与抽帧的目录白名单 |
| `VIGIL_EDGE_TOKEN` | 空 | Worker 回调网关的 Bearer 凭证，**生产环境务必设置** |
| `VIGIL_EVIDENCE_RETENTION_DAYS` | `365` | 证据保留天数 |
| `VIGIL_VISION_PORT` | `1985` | Worker 端口（仅回环） |
| `VIGIL_OPEN_VOCAB_CONF` | `0.30` | Gate 0：开放词汇词条的置信度底线 |
| `VIGIL_CONTEXT_WEAK_CONF` | `0.10` | Gate 0：关联客体的弱先验阈值 |
| `VIGIL_RESCUE_CONF` | `0.15` | Gate 0：补救重推理的放宽门槛（0 关闭） |
| `VIGIL_COAST_SECONDS` / `_FRAMES` / `_HARD_SECONDS` | `1.5` / `3` / `6.0` | 主体滑动保持窗口 |
| `VIGIL_HIT_DEDUPE_SECONDS` | `8` | 命中记录去重窗口 |
| `VIGIL_CPU_MAX_FPS` | `3` | CPU 推理总帧率预算 |
| `ENABLE_STREAM_PATROL` | `false` | 服务端自动巡检（开启后会消耗 VLM Token） |
| `VIGIL_DISABLE_VISION_ENGINE` / `VIGIL_DISABLE_STREAM_ENGINE` | 空 | 设为 `1` 分别关闭 Worker / go2rtc |

> **大模型凭证不是环境变量。** `OPENAI_API_KEY`、`AZURE_OPENAI_*` 之类的变量**不会被读取**。请在配置中心的「模型网关」中添加服务商：选择提供方，填写 **Base URL**、**API Key** 与**模型名称**（如 `gpt-4o`），并设为默认。档案持久化在 `data/models.json`（权限 600），接口只返回掩码后的密钥。可以用「测试连接」验证延迟与模型发现。

所有携带物理路径的接口都会拒绝空字节与 `..`，解析符号链接后再校验结果是否落在白名单内。

---

## 使用指南

### 第一步：添加视频流

打开配置中心，进入「系统核心配置 > 视频流」，新增通道：

| 字段 | 示例 |
| --- | --- |
| 名称 | `一楼` / `2楼`（任意易读的名称，这是整个界面里**唯一**展示的通道标识） |
| 区域 | `大厅` |
| 视频源 | `rtsp://admin:password@192.168.1.64:554/Streaming/Channels/102` |

常见 RTSP 地址：

| 厂商 | 主码流 | 子码流（AI 推荐） |
| --- | --- | --- |
| 海康威视 | `rtsp://user:pass@IP:554/Streaming/Channels/101` | `.../Streaming/Channels/102` |
| 大华 | `rtsp://user:pass@IP:554/cam/realmonitor?channel=1&subtype=0` | `...&subtype=1` |
| 通用 NVR（ONVIF） | `rtsp://user:pass@IP:554/<厂商路径>` | 同左 |

一级检测建议使用**子码流**（分辨率低、CPU 占用小）；NVR 支持的话，证据可保留主码流。系统生成的通道 ID 只是内部键，规则、命中、告警都绑定在该 ID 上，界面按名称展示，因此重命名通道不会破坏规则。

### 第二步：配置通道级感知词表

每个通道都有自己的一级词表。每条包含一个英文提示词（给 YOLO-World 使用）和一个角色：

| 角色 | ID | 含义 | 示例 |
| --- | --- | --- | --- |
| 主体锚点 | `anchor_person`（`ROLE_ANCHOR`） | 画面中的人员，经 ByteTrack 分配 Track ID，始终存在 | `person` |
| 行为主体 | `subject_target`（`ROLE_SUBJECT`） | 行为的发起者；非人员主体由滑动保持追踪器兜底 | `cat`、`dog` |
| 关联物体 | `context_object`（`ROLE_CONTEXT`） | 行为发生的对象或场所，**单独出现不触发**，只作弱先验 | `pet feeder`、`water dispenser`、`cat litter box` |
| PPE / 危险物 | `required_ppe`、`hazard_target` | 必备防护装备 / 危险物 | `hard hat`、`lighter` |

保持 CLIP 文本向量稳定的写法：

- 只用 **1 至 3 个核心名词**：`cat`、`pet feeder`、`water dispenser`、`cat litter box`。
- **不要**加颜色、材质、形状或尺寸，避免 `yellow open-top U-shaped entry litter box` 这类长定语。
- 词表保持精简，每个通道几条即可。词条越多，每条的得分越被稀释。
- 先确定行为主体，再只添加规则真正需要的关联物体。

### 第三步：定义 VLM 语义规则

在「规则与防抖」页新建规则：

1. **规则名称**：在卡片上就地编辑，修改会立即同步到告警流与看板。
2. **正向触发提示词**：描述必须成立的事实，例如“猫正在喂食器进食，或在饮水机饮水”。
3. **排除逻辑**：描述应当否决命中的因果链，例如“有人正在添加猫粮”“猫只是路过”。
4. **绑定通道**：勾选具体通道（按名称显示）。「全部视频源」与单个通道互斥，规则不会出现半全局的混合状态。
5. **灵敏度、严重度、冷却、生效时段**：按规则单独调整。默认冷却窗口为每通道每规则 60 秒。

### 第四步：稽查闭环与告警处置

- **命中记录抽屉**：每一次一级命中都带有标注帧、门禁追踪与研判结论。
- **人工送审**：选中一条命中（或一段多帧预录切片），按需送交二级复核。
- **告警流**：一键确认、驳回或升级；冷却窗口内的重复告警会折叠进已有案卷。
- **证据包**：导出包含关键帧、`manifest.json` 与 SHA-256 校验和的 ZIP，用于审计追溯。

---

## 最佳实践

- **每个场景一份词表。** 不要跨通道复制词表：2 楼需要 `cat`，1 楼需要 `person`。
- **漏检先看 Gate 0。** 打开门禁追踪，原始输出那一行会告诉你每个词条的得分，以及是哪道门槛拦住了它。
- **先调环境变量，再考虑改词条。** 对难检出的主体，先把 `VIGIL_OPEN_VOCAB_CONF` 下调（如 0.25），而不是不断堆新词。
- **一级检测用子码流**，并把 `VIGIL_CPU_MAX_FPS` 设为 CPU 能持续承受的值。
- **保护回调接口**：设置 `VIGIL_EDGE_TOKEN`，并让 `3000` 端口置于 HTTPS 之后。
- **保持 `ENABLE_STREAM_PATROL` 关闭**，除非你明确需要定时调用 VLM。
- **备份 `vigil_data` 数据卷**，其中保存规则、视频流、模型档案与证据。

---

## 接口概览

所有接口位于 `/api/v1` 下，完整清单见 [`docs/项目说明.md`](./docs/项目说明.md)。

| 领域 | 接口 |
| --- | --- |
| 健康 | `GET /health`、`POST /test-connection` |
| 视频流 | `GET/POST /streams`、`GET/PATCH/DELETE /streams/{id}`、`/streams/{id}/snapshot`、`/mjpeg`、`/annotated`、`/analyze`、`/test`、`/streams/engine` |
| 一级视觉 | `GET /vision/engine`、`GET/PUT /vision/config`、`GET/PUT /vision/channel-config`、`GET /vision/gate-traces`、`GET /vision/hits`、`GET /vision/learning`、`GET/PUT /roi-zones` |
| 二级研判 | `POST /vlm/analyze`（SSE）、`POST /incident/trigger`（边缘送审） |
| 规则 | `GET/POST /rules`、`PATCH/DELETE /rules/{id}`、`/rules/evaluate`、`/rules/suppress`、`/rules/simulate-storm`、`/rules/cluster` |
| 模型 | `GET/POST /models`、`PATCH/DELETE /models/{id}`、`POST /models/{id}/default` |
| 告警 | `GET /stream-alerts`、`GET/PATCH /stream-alerts/{alertId}`、`/archive`、`/frames/{index}` |

```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/streams
curl -X PATCH http://localhost:3000/api/v1/rules/RULE-04 \
  -H "content-type: application/json" -d '{"name":"烟火预警"}'
```

---

## 目录结构

```text
app/                    Next.js App Router（界面 + /api/v1 网关）
components/ops/         作业大屏：矩阵、感知、规则、告警
components/vigil/       配置中心：视频流、词表、模型网关
lib/ops/                规则类型、客户端工具、规则绑定
lib/ops/server/         规则引擎、VLM 适配、视觉编译、一级反哺
lib/vigil/              视觉配置、词表、一级学习
lib/storage/            基于文件的存储（规则、视频流、告警、证据）
lib/stream-engine.ts    go2rtc 守护
lib/vision-engine.ts    Python Worker 守护与代理
services/vision-worker/ FastAPI Worker：YOLO-World、ByteTrack、门禁
scripts/                setup-vision.mjs、setup-go2rtc.mjs
Dockerfile              四阶段生产镜像
docker-compose.yml      单服务编排
```

---

## 路线图

- 面向 Intel CPU 的 OpenVINO 导出路径（当前 Worker 使用 PyTorch，运行于 CPU 或 CUDA）。
- 可插拔的本地 VLM 运行器，并支持按通道路由。
- 面向门禁通过率与二级调用成本的 Prometheus 指标。

---

## 参与贡献

欢迎参与贡献。

1. **非小改动请先提 Issue。** 报告 Bug 请附上：版本或 commit、部署方式（Docker 或本地）、相关**门禁追踪**、截图与复现步骤；功能建议请描述场景和期望行为。
2. **Fork 并从 `main` 创建分支**：`feat/<主题>` 或 `fix/<主题>`。
3. **代码风格**：TypeScript 严格模式，Prettier（`pnpm format`），ESLint（`pnpm lint`）；Python 遵循 PEP 8 并加类型标注；界面使用现有 shadcn/ui 组件与设计 Token，不要硬编码颜色。
4. **提交前验证**：`pnpm typecheck` 与 `pnpm lint` 必须通过；修改 Worker 时执行 `python -m py_compile services/vision-worker/main.py`。
5. **发起 Pull Request**：写清变更说明、关联 Issue，界面改动请附截图；保持 PR 聚焦，一个 PR 只解决一件事。
6. 提交贡献即表示你同意以 Apache 2.0 协议授权你的代码。

---

## 安全与合规声明

Vigil-AI 是**AI 辅助的视频分析工具**。其输出具有概率性，可能出错，在做出任何纪律处分、法律或安全关键决策之前，必须由合格的人员复核。

使用者须自行负责遵守摄像头所在地适用的监控、隐私、劳动与数据保护法律法规（如 GDPR、CCPA、《个人信息保护法》），包括告知与同意、目的限制、保存期限与访问控制。禁止将本软件用于隐蔽监控、无法律依据的生物特征识别或任何违法用途。

使用云端托管模型时，送审的画面会离开你的内网；若画面不允许出站，请使用私有化部署的模型。

本软件按“现状”提供，不附带任何形式的担保（详见许可证）。

如需报告安全漏洞，请在 GitHub 上提交私密的安全公告（Security Advisory），不要公开提 Issue。

---

## 开源协议

基于 [Apache License 2.0](./LICENSE) 开源。

Copyright (c) 2026 Vigil-AI Authors / Qianze Blueprint Group & Linkup Tech.

第三方组件见 [`NOTICE`](./NOTICE)。请注意 Ultralytics YOLO-World 采用 AGPL-3.0（或商业 Enterprise 授权），你需要在自己的部署中自行遵守。
