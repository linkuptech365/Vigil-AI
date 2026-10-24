# syntax=docker/dockerfile:1.7

# 全部阶段统一使用 glibc 的 bookworm-slim：
# PyTorch / ultralytics / opencv 只提供 manylinux（glibc）预编译包，Alpine（musl）上无法安装完整视觉环境；
# 同时保证构建阶段与运行阶段的原生依赖（如 ffmpeg-static）平台一致。

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
# Stage 3: runner - 运行时（非 root）
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner

# ffmpeg: 取帧/转码；libgl1 + libglib2.0-0: opencv（ultralytics 依赖）运行库；
# ca-certificates: 下载 uv / 权重 / PyTorch 轮子所需的 HTTPS 根证书
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# 规则库与视觉环境（uv / 内置 Python / venv / 权重 / 缓存）都落在这个命名卷内：
# 运行用户可写，且容器重建后不用重新下载几个 GB 的依赖。视觉主目录默认为 $VIGIL_DATA_DIR/vision
ENV VIGIL_DATA_DIR=/app/data

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/nextjs --shell /usr/sbin/nologin nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 视觉环境的安装脚本与 Python 服务源码（standalone 产物不会包含这两个目录）
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

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
