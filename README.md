<div align="center">

# Vigil-AI | 视频分析与智能预警平台 (OmniVision Sentinel)

基于多模态大模型的视频监控分析与异常预警平台：边缘初筛、VLM 二级研判、规则防抖、处置与审计存证一体化。

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Lucide](https://img.shields.io/badge/Icons-Lucide-F56565)
![SWR](https://img.shields.io/badge/Data-SWR-000000)
![VLM](https://img.shields.io/badge/VLM-Qwen2.5--VL%20%7C%20GPT--4o-7C3AED)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## 目录

- [系统分层设计](#系统分层设计)
- [生物医药洁净室 GMP 专项](#生物医药洁净室-gmp-专项)
- [快速启动](#快速启动)
- [环境变量](#环境变量)
- [接口契约](#接口契约)
- [项目结构](#项目结构)
- [License](#license)

---

## 系统分层设计

平台自下而上分为五层，每一层只向上游输出"更少但更有价值"的事件，以此控制推理成本与告警噪声。

| 层级 | 名称 | 核心能力 |
| --- | --- | --- |
| L1 | 接入层 (Ingestion) | 1~10 FPS 动态抽帧，每路通道保留 30 秒环形缓存 (Ring Buffer) |
| L2 | 一级感知 (Tier-1 Perception) | YOLOv11 目标检测 + ByteTrack 多目标追踪，边缘初筛节省约 88% 推理 Token |
| L3 | 二级认知 (Tier-2 VLM Cognition) | Qwen2.5-VL / GPT-4o 多模态研判，因果推理链与 Video-RAG 语义检索 |
| L4 | 规则与防抖 (Rules & Anti-Flapping) | 60 秒冷却窗口去重、跨机位时空聚类并单 |
| L5 | 处置与归档 (Dispatch & Archival) | GMP 偏差单 (Deviation) 与 CAPA 流程，SHA-256 校验的 ZIP 存证包 |

### L1 接入层

- 运动增量低于阈值时降至 1 FPS，检测到运动后提升到 5~10 FPS，也可切换为固定 FPS。
- 每路通道维护 30 秒环形切片缓存；事件触发时冻结缓存，防止证据被覆写。
- 直播流支持 HLS、WHEP 与直连播放，拉流失败自动回退，并提供 QoS 采样面板。

### L2 一级感知

- 边缘侧使用 YOLO + ByteTrack 对目标做检测与追踪，仅将"值得研判"的关键帧上送。
- 支持 ROI 多边形区域与单向绊线（Tripwire）几何判定。

### L3 二级认知

- 关键帧与规则场景提交到 `/api/v1/vlm/analyze`，以 SSE 流式返回研判结果。
- 输出包含结论摘要、意图分析、严重等级、置信度、因果推理链与证据帧。
- 未配置远端模型或远端不可用时，服务端自动使用离线兜底引擎，并在结果中标明来源。

### L4 规则与防抖

- 每条规则默认 60 秒冷却窗口：窗口内同通道同规则的重复触发折叠进已有工单。
- 跨机位按时间、语义、拓扑三个维度计算亲和度，将同一事件的多路告警聚类为一张关联工单。
- 规则库由服务端持有，支持启停、灵敏度、严重等级、冷却时长、排程与绑定通道。

### L5 处置与归档

- 偏差单与 CAPA（纠正与预防措施）审批流，状态与审计日志可追溯。
- 存证包使用 Web Crypto 计算 SHA-256，并通过 `jszip` 在浏览器端生成 ZIP 下载。

---

## 生物医药洁净室 GMP 专项

针对疫苗生产等 GMP 洁净室场景，平台内置一套 4 个基准算例，可一键注入到检测队列，用于验证规则命中、研判报告与存证流程。

| 算例 | 文件 | 绑定规则 | 预期结果 |
| --- | --- | --- | --- |
| ESD Shoes Violation（防静电鞋违规） | `case_bio_01_esd_shoes_violation.mp4` | `RULE-BIO-01` | 命中：更衣室进入生产区未穿戴合规防静电鞋 |
| Airlock Transfer Collision（气锁传递碰撞） | `case_bio_02_aseptic_transfer_collision.mp4` | `RULE-BIO-02` | 命中：传递窗异常碰撞与交叉污染风险 |
| Class A Laminar Flow Touch（A 级层流区触碰） | `case_bio_03_class_a_zone_touch.mp4` | `RULE-BIO-03` | 命中：A 级核心区未授权触碰，阻断 |
| Standard Aseptic Baseline（无菌规范基线） | `case_bio_04_standard_gmp_operation.mp4` | `RULE-BIO-04` | 不命中：规范作业对照组，用于验证无误报 |

使用方式：

1. 在 `/console` 的"检测队列"点击 **Load GMP Suite**，服务端会把算例写入 `/tmp/vigil-test` 并返回真实文件路径。
2. 运行 AI 研判，查看研判报告与规则命中情况。
3. 在 Ops 大屏的"审计与 CAPA"中处理偏差单，并导出 SHA-256 校验的 ZIP 存证包。

---

## 快速启动

### 环境要求

- Node.js 20 及以上
- pnpm 10（项目使用 `pnpm-lock.yaml`）
- 构建时需能访问 `fonts.googleapis.com`（`next/font` 会下载 Geist 字体）

### 本地开发

```bash
pnpm install
pnpm dev
```

启动后访问：

- Ops 大屏：<http://localhost:3000>
- 检测队列控制台：<http://localhost:3000/console>

常用脚本：

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint
pnpm build       # 生成 standalone 产物
pnpm start
```

> 使用 npm 的用户可执行 `npm install && npm run dev`，但锁文件以 pnpm 为准。

### Docker Compose

```bash
cp .env.example .env     # 可选：按需修改变量
mkdir -p videos          # 放置待分析的监控录像
docker compose up -d
```

- 访问地址：<http://localhost:3000>
- 健康检查：`curl http://localhost:3000/api/v1/health`
- 查看日志：`docker compose logs -f vigil-ai`
- 停止服务：`docker compose down`（加 `-v` 同时清除 `vigil_storage` 卷）

容器内路径约定：

| 容器路径 | 来源 | 用途 |
| --- | --- | --- |
| `/data/videos` | 绑定挂载 `./videos` | 物理监控录像，在 `/console` 中填写此路径进行目录扫描 |
| `/tmp/vigil-test` | 命名卷 `vigil_storage` | GMP 基准算例写入目录，容器重建后保留 |
| `/app/data` | 命名卷 `vigil_data` | 规则库 `rules.json`，新建、修改、删除规则均写入此处，容器重建后保留 |

镜像采用三阶段构建（deps、builder、runner），运行时使用非 root 用户 `nextjs:nodejs`，并通过 `HEALTHCHECK` 探测 `/api/v1/health`。

---

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 网关监听端口，Docker 镜像内固定为 3000 |
| `VIGIL_ALLOWED_ROOTS` | `/data/videos:/tmp:/tmp/vigil-test` | 扫描与抽帧允许访问的目录白名单，Linux 以 `:` 分隔；项目目录与系统临时目录始终允许 |
| `VIGIL_DATA_DIR` | `<cwd>/data` | 规则库持久化目录，规则保存为其中的 `rules.json`；Docker 内为 `/app/data`，以命名卷 `vigil_data` 挂载，容器重建后保留 |
| `VIGIL_SCAN_DIR` | 空 | 可选。视频流接口按文件名/相对路径寻址时额外查找的根目录，同时自动加入白名单 |
| `NEXT_PUBLIC_DEFAULT_VLM_MODEL` | `qwen2.5-vl-72b` | 默认二级研判模型标识 |
| `VLM_API_URL` | `http://localhost:8000/api/v1/analyze` | VLM 推理网关地址 |
| `VLM_API_KEY` | 空 | VLM 推理网关密钥，请勿提交到仓库 |

> 当前版本的 VLM 地址、密钥与模型由控制台"API 配置"面板随请求提交，服务端不会读取 `VLM_API_URL` / `VLM_API_KEY` 作为默认值；这两项在 `.env.example` 中作为部署模板保留。

目录白名单是安全边界：所有携带物理路径的接口都会拒绝空字节、`..` 跳转，并在解析符号链接后校验路径落在白名单之内。

---

## 接口契约

所有接口前缀为 `/api/v1`，请求与响应均为 JSON（`vlm/analyze` 默认返回 SSE）。错误响应统一为 `{ "error": string, "code": string }` 或 `{ "status": "error", "message": string }`。

### 基础与连通性

| 方法 | 路径 | 说明 | 关键参数 |
| --- | --- | --- | --- |
| `GET` | `/health` | 网关健康检查，返回服务名、版本、时间戳与运行时长 | 无 |
| `POST` | `/test-connection` | 测试远端 VLM 网关连通性，返回 RTT 与探测到的模型 | `apiUrl`, `apiKey?`, `modelName?` |

### 视频与研判

| 方法 | 路径 | 说明 | 关键参数 |
| --- | --- | --- | --- |
| `POST` | `/scan-folder` | 扫描白名单目录下的视频文件��读取真实元数据 | `folderPath`, `recursive?`, `filterExtensions?` |
| `POST` | `/extract-frames` | 对指定视频生成 8 帧关键帧与运动评分 | `videoPath`, `fps?` (1 / 2 / 5), `triggerTimestampSec?` |
| `POST` | `/vlm/analyze` | 多模态研判，SSE 流式返回思考过程与最终结论 | `videoPath?`, `keyframes?`, `apiUrl?`, `apiKey?`, `modelName?`, `ruleScenario?`, `stream?` |
| `POST` | `/samples/provision` | 将 4 个 GMP 基准算例写入 `/tmp/vigil-test` 并返回文件清单 | 无 |

### 规则引擎

| 方法 | 路径 | 说明 | 关键参数 |
| --- | --- | --- | --- |
| `GET` | `/rules` | 获取全部规则 | 无 |
| `POST` | `/rules` | 创建自定义规则 | `name`, `prompt`, `sensitivity` (0.6~0.95), `actions` |
| `PATCH` | `/rules/{id}` | 更新规则 | `enabled?`, `severity?`, `cooldownSeconds?`, `schedule?`, `boundChannels?`, `sensitivity?`, `actions?` |
| `POST` | `/rules/evaluate` | 评估一次目标是否违规（ROI 多边形 / 绊线 / 语义匹配），并执行冷却窗口去重 | `channelId`, `ruleId?`, `targetCoords?`, `previousCoords?`, `targetClass?`, `confidence`, `scenarioText?` |
| `GET` / `POST` | `/rules/suppress` | `GET` 读取各通道防抖快照；`POST` 登记一次触发并返回是否被折叠 | `channelId`, `ruleId?` |
| `POST` | `/rules/simulate-storm` | 模拟告警风暴，验证 60 秒窗口内的折叠效果 | `channelId`, `ruleId?`, `count?` (2~20), `spacingMs?` (0~1500) |
| `GET` / `POST` | `/rules/cluster` | 跨机位时空聚类；`GET` 可带 `windowSeconds`，`POST` 可传入自定义事件列表 | `events?`, `windowSeconds?` |

### 调用示例

```bash
# 健康检查
curl http://localhost:3000/api/v1/health

# 注入 GMP 基准算例
curl -X POST http://localhost:3000/api/v1/samples/provision

# 扫描目录
curl -X POST http://localhost:3000/api/v1/scan-folder \
  -H "content-type: application/json" \
  -d '{"folderPath":"/data/videos","recursive":true}'

# 评估规则（坐标归一化到 0~1000）
curl -X POST http://localhost:3000/api/v1/rules/evaluate \
  -H "content-type: application/json" \
  -d '{"channelId":"CAM-03","confidence":0.92,"targetClass":"person","targetCoords":[500,500]}'
```

---

## 项目结构

```text
app/
  api/v1/            网关接口（health、scan-folder、extract-frames、vlm、rules、samples ...）
  console/           检测队列控制台
components/
  ops/               Ops 大屏：监控矩阵、接入、感知、VLM、规则、处置与审计
  vigil/             控制台：队列、详情弹窗、API 配置
lib/
  ops/               类型、场景数据、客户端请求封装
  ops/server/        服务端引擎：路径守卫、VLM 适配器与兜底、规则引擎
Dockerfile           三阶段生产镜像
docker-compose.yml   单服务编排
```

---

## License

[MIT](./LICENSE)
