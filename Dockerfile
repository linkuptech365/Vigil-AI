# syntax=docker/dockerfile:1.7

# 全部阶段统一使用 glibc 的 bookworm-slim：
# PyTorch / ultralytics / opencv 只提供 manylinux（glibc）预编译包，Alpine（musl）上无法安装完整视觉环境；
# bookworm 自带 Python 3.11，视觉阶段与运行阶段共用同一发行版，venv 内的解释器软链接在两个阶段都有效。

# ---------------------------------------------------------------------------
# Stage 1: deps - 仅安装依赖，利用层缓存（锁文件不变则不重装）
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: builder - 构建 Next.js standalone 产物
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# 构建阶段 next/font 需要访问 fonts.googleapis.com 下载 Geist 字体
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 3: vision - 视觉环境整体固化在镜像内（Python 3.11 + 依赖 + 模型权重）
#
# 只依赖 requirements.txt：Next.js 代码、vision-worker 源码改动都不会让这一阶段的缓存失效，
# 重新部署时 PyTorch / ultralytics / 权重全部命中层缓存，运行时零安装、零下载。
# 目录布局与 scripts/lib/python-runtime.mjs 的 visionPaths(VIGIL_PYTHON_HOME) 完全一致：
#   <home>/venv    虚拟环境        <home>/models  YOLO-World 权重
#   <home>/cache   torch / ultralytics / matplotlib 等缓存      <home>/home  运行时 HOME（含 CLIP 文本权重）
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS vision

# 默认 CPU 版 PyTorch（约 200MB，镜像体积小）；GPU 主机构建时覆盖：
#   docker build --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124 .
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
# YOLO-World 开放词汇依赖的 CLIP 文本编码器；zip 直装，不依赖 git
ARG CLIP_PACKAGE=https://github.com/ultralytics/CLIP/archive/refs/heads/main.zip

ENV VISION_HOME=/opt/vigil-vision
ENV VENV=/opt/vigil-vision/venv

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv libgl1 libglib2.0-0 libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -c "import sys; assert sys.version_info[:2] == (3, 11), f'需要 Python 3.11，实际 {sys.version}'" \
    && python3 -m venv "$VENV"

COPY services/vision-worker/requirements.txt /tmp/vision-requirements.txt

# 构建期安装全部 Python 依赖；pip 缓存挂载只在构建机上加速，不会进入镜像
RUN --mount=type=cache,id=pip-vision,target=/root/.cache/pip \
    "$VENV/bin/pip" install --disable-pip-version-check --upgrade pip \
    && "$VENV/bin/pip" install --disable-pip-version-check torch torchvision --index-url "$TORCH_INDEX_URL" \
    && "$VENV/bin/pip" install --disable-pip-version-check -r /tmp/vision-requirements.txt \
    && "$VENV/bin/pip" install --disable-pip-version-check ftfy regex "$CLIP_PACKAGE"

# 缓存目录与运行时 visionRuntimeEnv() 保持一致，预热产物才会在运行时被命中；
# HOME 同样固定到视觉目录，因为 CLIP 默认写入 ~/.cache/clip
ENV HOME=/opt/vigil-vision/home
ENV XDG_CACHE_HOME=/opt/vigil-vision/cache
ENV TORCH_HOME=/opt/vigil-vision/cache/torch
ENV HF_HOME=/opt/vigil-vision/cache/huggingface
ENV YOLO_CONFIG_DIR=/opt/vigil-vision/cache/ultralytics
ENV MPLCONFIGDIR=/opt/vigil-vision/cache/matplotlib
# 禁止 ultralytics 在运行时偷偷 pip install 缺失依赖
ENV YOLO_AUTOINSTALL=False

# 构建期预下载模型权重并预热 CLIP 文本编码器，固化进镜像
RUN mkdir -p "$HOME" "$XDG_CACHE_HOME" /opt/vigil-vision/models \
    && cd /opt/vigil-vision/models \
    && "$VENV/bin/python" -c "from ultralytics import YOLOWorld; m = YOLOWorld('yolov8s-worldv2.pt'); m.set_classes(['person', 'cat', 'pet feeder']); print('vision warmup ok')" \
    && test "$(stat -c%s /opt/vigil-vision/models/yolov8s-worldv2.pt)" -gt 5000000

# 构建期自检：核心依赖可导入、权重在位；任何一项缺失都让构建失败，而不是把半成品带到运行时
RUN "$VENV/bin/python" -c "import fastapi, uvicorn, cv2, numpy, httpx, pydantic, supervision, torch, torchvision, ultralytics, clip; print('torch', torch.__version__, '| ultralytics', ultralytics.__version__)" \
    && ls -lh /opt/vigil-vision/models \
    && find /opt/vigil-vision -path /opt/vigil-vision/venv -prune -o -type f -size +5M -print | sort

# ---------------------------------------------------------------------------
# Stage 4: runner - 运行时（非 root）
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner

# ffmpeg: 取帧/转码；python3: venv 内解释器的软链接目标（只需运行时，不含 pip）；
# libgl1 + libglib2.0-0 + libgomp1: opencv / PyTorch 运行库；ca-certificates: HTTPS 根证书
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 libgl1 libglib2.0-0 libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# 规则库等业务数据落在这个命名卷内；视觉环境不再放卷里，而是随镜像发布
ENV VIGIL_DATA_DIR=/app/data

# 视觉环境固化在镜像：解释器、权重目录、缓存目录都显式指向 /opt/vigil-vision，
# 引擎启动时直接命中，不会去探测系统 Python，也不会触发 setup-vision
ENV VIGIL_PYTHON_HOME=/opt/vigil-vision
ENV VIGIL_PYTHON=/opt/vigil-vision/venv/bin/python
ENV VIGIL_PREBAKED_VISION=1
ENV HOME=/opt/vigil-vision/home
ENV YOLO_AUTOINSTALL=False

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin nextjs

# 体积最大、变化最少的层放在应用代码之前：应用改动不会使它失效。
# --chown 在拷贝时直接落属主，避免再 chown -R 产生一份同样大小的重复层
COPY --from=vision --chown=nextjs:nodejs /opt/vigil-vision /opt/vigil-vision

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 引擎需要的脚本（python-runtime.mjs）与 Python 服务源码（standalone 产物不会包含这两个目录）
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/services/vision-worker/main.py /app/services/vision-worker/requirements.txt ./services/vision-worker/

# /data/videos: 物理监控录像挂载点；/tmp/vigil-test: GMP 基准算例写入目录
# /app/data: 持久化目录，compose 以命名卷挂载；预先创建并赋权，命名卷首次挂载时会继承该目录的属主
# /app 本身也交给运行用户，避免任何回退到项目根目录的写入（如 VIGIL_DATA_DIR 未设置）因权限失败
RUN mkdir -p /data/videos /tmp/vigil-test /app/data \
    && chown nextjs:nodejs /app \
    && chown -R nextjs:nodejs /data /tmp/vigil-test /app/data

USER nextjs

EXPOSE 3000

# 视觉 Worker 首次 import torch 需要十几秒，start-period 留足余量
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
