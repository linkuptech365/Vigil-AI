#!/usr/bin/env node
/**
 * 下载并安装内置流媒体引擎 go2rtc（MIT，单文件零依赖）到 bin/ 目录。
 *
 *   node scripts/setup-go2rtc.mjs            安装（已存在则跳过）
 *   node scripts/setup-go2rtc.mjs --force    强制重新下载
 *   node scripts/setup-go2rtc.mjs --soft     失败时只打印提示、退出码恒为 0（用于 postinstall）
 *
 * 环境变量：
 *   GO2RTC_SKIP_DOWNLOAD=1      跳过下载（离线/CI）
 *   GO2RTC_DOWNLOAD_BASE=<url>  自定义镜像前缀，默认 GitHub Releases latest
 *   VIGIL_BIN_DIR=<dir>         二进制存放目录，默认 <项目根>/bin
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = new Set(process.argv.slice(2))
const soft = args.has("--soft")
const force = args.has("--force")

const ASSETS = {
  "win32-x64": "go2rtc_win64.zip",
  "win32-ia32": "go2rtc_win32.zip",
  "win32-arm64": "go2rtc_win_arm64.zip",
  "linux-x64": "go2rtc_linux_amd64",
  "linux-arm64": "go2rtc_linux_arm64",
  "linux-arm": "go2rtc_linux_arm",
  "linux-ia32": "go2rtc_linux_i386",
  "darwin-x64": "go2rtc_mac_amd64.zip",
  "darwin-arm64": "go2rtc_mac_arm64.zip",
}

const platformKey = `${process.platform}-${process.arch}`
const binDir = path.resolve(process.env.VIGIL_BIN_DIR?.trim() || path.join(root, "bin"))
const binName = process.platform === "win32" ? "go2rtc.exe" : "go2rtc"
const target = path.join(binDir, binName)
const base = (process.env.GO2RTC_DOWNLOAD_BASE?.trim() || "https://github.com/AlexxIT/go2rtc/releases/latest/download").replace(/\/+$/, "")

function log(message) {
  console.log(`[setup-go2rtc] ${message}`)
}

function finish(code, message) {
  if (message) (code === 0 ? log : console.error)(code === 0 ? message : `[setup-go2rtc] ${message}`)
  process.exit(soft ? 0 : code)
}

function works(file) {
  const result = spawnSync(file, ["-version"], { timeout: 8000, encoding: "utf8" })
  return result.status === 0 || /go2rtc/i.test(`${result.stdout}${result.stderr}`)
}

async function download(url) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      log(`下载失败（第 ${attempt}/3 次）：${error instanceof Error ? error.message : error}`)
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
    }
  }
  throw lastError
}

async function extractFromZip(buffer) {
  let JSZip
  try {
    JSZip = (await import("jszip")).default
  } catch {
    throw new Error("缺少 jszip 依赖，无法解压 zip 包，请先执行 pnpm install")
  }
  const zip = await JSZip.loadAsync(buffer)
  const entry = Object.values(zip.files).find((file) => !file.dir && /(^|\/)go2rtc(\.exe)?$/i.test(file.name))
  if (!entry) throw new Error("压缩包内未找到 go2rtc 可执行文件")
  return Buffer.from(await entry.async("uint8array"))
}

async function main() {
  if (process.env.GO2RTC_SKIP_DOWNLOAD === "1") return finish(0, "已设置 GO2RTC_SKIP_DOWNLOAD=1，跳过下载。")

  if (!force && fs.existsSync(target) && works(target)) return finish(0, `已存在可用的 go2rtc：${target}`)

  const asset = ASSETS[platformKey]
  if (!asset) {
    return finish(1, `当前平台 ${platformKey} 没有预编译的 go2rtc，请手动下载并放到 ${target}`)
  }

  const url = `${base}/${asset}`
  log(`平台 ${platformKey}，下载 ${url}`)

  let binary = await download(url)
  if (asset.endsWith(".zip")) binary = await extractFromZip(binary)
  if (binary.length < 1_000_000) throw new Error(`下载内容异常（仅 ${binary.length} 字节）`)

  fs.mkdirSync(binDir, { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, binary)
  if (process.platform !== "win32") fs.chmodSync(temp, 0o755)
  fs.rmSync(target, { force: true })
  fs.renameSync(temp, target)

  if (!works(target)) {
    fs.rmSync(target, { force: true })
    throw new Error("下载的二进制无法在本机运行，已删除；请确认平台/架构是否匹配")
  }
  finish(0, `安装完成：${target}（${(binary.length / 1024 / 1024).toFixed(1)} MB）`)
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error)
  finish(
    1,
    `安装失败：${reason}\n  可手动下载 ${ASSETS[platformKey] ?? "对应平台的包"} 并放到 ${target}，或设置 GO2RTC_DOWNLOAD_BASE 使用镜像后重试：pnpm setup:engine`
  )
})
