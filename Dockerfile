# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Stage 1: deps - 仅安装依赖，利用层缓存（锁文件不变则不重装）
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: builder - 构建 Next.js standalone 产物
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# 构建阶段 next/font 需要访问 fonts.googleapis.com 下载 Geist 字体
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 3: runner - 精简运行时（非 root）
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat ffmpeg
WORKDIR /app

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# /data/videos: 物理监控录像挂载点；/tmp/vigil-test: GMP 基准算例写入目录
# /app/data: 规则库持久化目录（rules.json），compose 以命名卷挂载；
# 预先创建并赋权，命名卷首次挂载时会继承该目录的属主
RUN mkdir -p /data/videos /tmp/vigil-test /app/data \
    && chown -R nextjs:nodejs /data /tmp/vigil-test /app/data

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/v1/health" || exit 1

CMD ["node", "server.js"]
