#!/usr/bin/env node
/**
 * 初始化本地视觉初筛环境（Tier-1：YOLO-World + ByteTrack）。
 *
 *   node scripts/setup-vision.mjs            完整安装（PyTorch + ultralytics + 权重）
 *   node scripts/setup-vision.mjs --cpu      使用体积小得多的 CPU 版 PyTorch（无 GPU 的服务器/容器推荐）
 *   node scripts/setup-vision.mjs --light    只装帧差所需依赖，不装 PyTorch，视觉服务以 motion-only 模式运行
 *   node scripts/setup-vision.mjs --skip-weights   不下载模型权重
 *
 * 等价环境变量：VIGIL_VISION_CPU=1 / VIGIL_VISION_LIGHT=1 / VIGIL_VISION_SKIP_WEIGHTS=1
 * 可用 VIGIL_PYTHON 指定系统 Python，VIGIL_MODELS_DIR 指定权重目录。
 */
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const workerDir = path.join(root, "services", "vision-worker")
const venvDir = path.join(workerDir, ".venv")
const modelsDir = path.resolve(process.env.VIGIL_MODELS_DIR?.trim() || path.join(root, "models"))
const weightsPath = path.join(modelsDir, "yolov8s-worldv2.pt")
const WEIGHTS_URLS = [
  "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8s-worldv2.pt",
  "https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8s-worldv2.pt",
]
const CLIP_PACKAGE = "git+https://github.com/ultralytics/CLIP.git"

const args = new Set(process.argv.slice(2))
const light = args.has("--light") || process.env.VIGIL_VISION_LIGHT === "1"
const cpuOnly = args.has("--cpu") || process.env.VIGIL_VISION_CPU === "1"
const skipWeights = args.has("--skip-weights") || process.env.VIGIL_VISION_SKIP_WEIGHTS === "1"

const isWin = process.platform === "win32"
const venvPython = path.join(venvDir, isWin ? "Scripts" : "bin", isWin ? "python.exe" : "python")

const say = (message) => console.log(`[setup-vision] ${message}`)
const fail = (message) => {
  console.error(`[setup-vision] 失败：${message}`)
  process.exit(1)
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: "inherit", windowsHide: true, ...options })
    const timer = options.timeoutMs ? setTimeout(() => child.kill(), options.timeoutMs) : null
    child.once("error", (error) => {
      if (timer) clearTimeout(timer)
      console.error(`[setup-vision] 无法执行 ${command}：${error.message}`)
      resolve(-1)
    })
    child.once("exit", (code) => {
      if (timer) clearTimeout(timer)
      resolve(code ?? -1)
    })
  })
}

function findPython() {
  const candidates = [process.env.VIGIL_PYTHON?.trim(), "python3", "python", isWin ? "py" : null].filter(Boolean)
  for (const command of candidates) {
    const probe = spawnSync(command, ["-c", "import sys;print('%d.%d' % sys.version_info[:2])"], { encoding: "utf8", windowsHide: true })
    if (probe.status !== 0) continue
    const [major, minor] = probe.stdout.trim().split(".").map(Number)
    if (major === 3 && minor >= 9) return command
  }
  return null
}

async function downloadWeights() {
  if (fs.existsSync(weightsPath) && fs.statSync(weightsPath).size > 5_000_000) {
    say(`权重已存在：${weightsPath}`)
    return true
  }
  fs.mkdirSync(modelsDir, { recursive: true })
  for (const url of WEIGHTS_URLS) {
    const temp = `${weightsPath}.download`
    try {
      say(`下载 YOLO-World 权重：${url}`)
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(600_000) })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp))
      if (fs.statSync(temp).size < 5_000_000) throw new Error("下载内容过小，疑似被代理改写")
      fs.renameSync(temp, weightsPath)
      say(`权重已缓存至 ${weightsPath}`)
      return true
    } catch (error) {
      fs.rmSync(temp, { force: true })
      console.warn(`[setup-vision] 下载失败：${error instanceof Error ? error.message : error}`)
    }
  }
  return false
}

async function main() {
  say(`模式：${light ? "light（仅帧差 motion-only，不安装 PyTorch）" : cpuOnly ? "完整安装（CPU 版 PyTorch）" : "完整安装（默认 PyTorch，Linux 下可能含 CUDA 组件，体积较大）"}`)

  if (!fs.existsSync(venvPython)) {
    const python = findPython()
    if (!python) fail("未找到 Python 3.9+，请先安装 Python 3（或用 VIGIL_PYTHON 指定路径），并确认 python3-venv 可用")
    say(`使用 ${python} 创建虚拟环境：${venvDir}`)
    const code = await run(python, ["-m", "venv", venvDir])
    if (code !== 0 || !fs.existsSync(venvPython)) fail("创建虚拟环境失败；Debian/Ubuntu 请先执行 apt-get install python3-venv")
  } else {
    say(`复用已有虚拟环境：${venvDir}`)
  }

  const pip = (extra, options) => run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", ...extra], options)
  await pip(["--upgrade", "pip"])

  const requirements = fs
    .readFileSync(path.join(workerDir, "requirements.txt"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter((line) => !light || !/^(ultralytics|supervision)\b/i.test(line))

  if (!light && cpuOnly) {
    say("安装 CPU 版 PyTorch…")
    const code = await pip(["torch", "torchvision", "--index-url", "https://download.pytorch.org/whl/cpu"], { timeoutMs: 1_800_000 })
    if (code !== 0) fail("安装 CPU 版 PyTorch 失败，请检查网络")
  }

  say(`安装依赖：${requirements.join(", ")}`)
  const installed = await pip(requirements, { timeoutMs: 1_800_000 })
  if (installed !== 0) fail("依赖安装失败，请检查网络或 pip 源")

  let weightsOk = true
  let clipOk = true
  if (!light) {
    say("安装 CLIP 文本编码器（YOLO-World 开放词汇所需，依赖 git）…")
    const clipCode = await pip(["ftfy", "regex", CLIP_PACKAGE], { timeoutMs: 600_000 })
    clipOk = clipCode === 0
    if (!clipOk) console.warn("[setup-vision] CLIP 安装失败：请确认已安装 git 且能访问 github.com，随后重新运行本脚本")

    if (!skipWeights) weightsOk = await downloadWeights()

    if (weightsOk && clipOk) {
      say("预热：加载权重并缓存 CLIP 文本权重（首次约需数分钟）…")
      const warm = [
        "from ultralytics import YOLOWorld",
        `m = YOLOWorld(r'${weightsPath.replace(/\\/g, "\\\\")}')`,
        "m.set_classes(['person'])",
        "print('warmup ok')",
      ].join("\n")
      const code = await run(venvPython, ["-c", warm], { timeoutMs: 1_200_000 })
      if (code !== 0) console.warn("[setup-vision] 预热失败：服务首次启动时会再次尝试，期间处于 degraded (motion-only) 模式")
    }
  }

  say("完成。")
  if (light) say("当前为 light 模式：仅运行 Tier-0 帧差。需要 YOLO-World 时请运行 npm run setup:vision（不带 --light）。")
  else if (!weightsOk || !clipOk) say("部分组件未就绪，视觉服务会以 degraded (motion-only) 模式运行，并在控制台显示具体原因。")
  else say("YOLO-World + ByteTrack 环境就绪，启动应用后会自动拉起 vision-worker。")
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
