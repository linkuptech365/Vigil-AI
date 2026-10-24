#!/usr/bin/env node
/**
 * 初始化本地视觉初筛环境（Tier-1：YOLO-World + ByteTrack）。
 *
 *   node scripts/setup-vision.mjs            完整安装（自动识别 GPU：有 NVIDIA 显卡装 CUDA 版 PyTorch，否则装 CPU 版）
 *   node scripts/setup-vision.mjs --cpu      强制 CPU 版 PyTorch
 *   node scripts/setup-vision.mjs --gpu      强制默认（CUDA）版 PyTorch
 *   node scripts/setup-vision.mjs --light    只装帧差所需依赖，不装 PyTorch，视觉服务以 motion-only 模式运行
 *   node scripts/setup-vision.mjs --uv       即使系统有 Python 也使用 uv 内置的独立 Python 3.11
 *   node scripts/setup-vision.mjs --skip-weights   不下载模型权重
 *
 * 系统没有可用的 Python 3.9+（或 python3-venv 缺失）时，脚本会自动下载 uv 到 bin/uv，
 * 再用它把独立的 Python 3.11 装进视觉主目录并创建虚拟环境，全程无需系统级安装。
 *
 * 视觉主目录：VIGIL_PYTHON_HOME，未设置时取 <VIGIL_DATA_DIR>/vision（Docker 里是持久化的 /app/data/vision），
 * 两者都没有时回退到项目内的 .python / services/vision-worker/.venv / models / bin（本地开发）。
 *
 * 等价环境变量：VIGIL_VISION_CPU=1 / VIGIL_VISION_GPU=1 / VIGIL_VISION_LIGHT=1 / VIGIL_VISION_SKIP_WEIGHTS=1 / VIGIL_USE_UV=1
 * 可用 VIGIL_PYTHON 指定系统 Python，VIGIL_MODELS_DIR 指定权重目录，VIGIL_UV_DOWNLOAD_BASE 指定 uv 下载镜像。
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

import {
  EMBEDDED_PYTHON_VERSION,
  checkWritableDir,
  ensureUv,
  findPython,
  hasNvidiaGpu,
  isMusl,
  probePython,
  uvEnv,
  visionPaths,
  visionRuntimeEnv,
} from "./lib/python-runtime.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const workerDir = path.join(root, "services", "vision-worker")
const paths = visionPaths(root)
const { venvDir, modelsDir, pythonDir } = paths
const weightsPath = path.join(modelsDir, "yolov8s-worldv2.pt")
const WEIGHTS_URLS = [
  "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8s-worldv2.pt",
  "https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8s-worldv2.pt",
]
// zip 直装，不依赖 git（内置 Python 场景下用户机器上通常也没有 git）
const CLIP_PACKAGE = "https://github.com/ultralytics/CLIP/archive/refs/heads/main.zip"

const args = new Set(process.argv.slice(2))
const light = args.has("--light") || process.env.VIGIL_VISION_LIGHT === "1"
const forceGpu = args.has("--gpu") || process.env.VIGIL_VISION_GPU === "1"
const forceCpu = args.has("--cpu") || process.env.VIGIL_VISION_CPU === "1"
const forceUv = args.has("--uv") || process.env.VIGIL_USE_UV === "1"
const gpuDetected = !light && !forceCpu && !forceGpu && hasNvidiaGpu()
const cpuOnly = !forceGpu && !gpuDetected
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
    const child = spawn(command, commandArgs, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, ...visionRuntimeEnv(root) },
      ...options,
    })
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

const venvHealthy = () => fs.existsSync(venvPython) && probePython({ command: venvPython, args: [], source: "venv" }) !== null

function pipWorks() {
  return probePython({ command: venvPython, args: [], source: "venv" }) !== null && spawnPip()
}

function spawnPip() {
  return new Promise((resolve) => {
    const child = spawn(venvPython, ["-m", "pip", "--version"], { stdio: "ignore", windowsHide: true })
    child.once("error", () => resolve(false))
    child.once("exit", (code) => resolve(code === 0))
  })
}

/** 用 uv 在项目内安装独立 Python 并创建带 pip 的 .venv */
async function createVenvWithUv() {
  let uv
  try {
    uv = await ensureUv(root, say)
  } catch (error) {
    fail(`${error instanceof Error ? error.message : error}。可手动安装 Python 3.9+，或设置 VIGIL_UV_DOWNLOAD_BASE 使用镜像后重试`)
  }
  const env = uvEnv(root)
  say(`使用 uv 安装内置 Python ${EMBEDDED_PYTHON_VERSION}（目录：${pythonDir}）…`)
  const installCode = await run(uv, ["python", "install", EMBEDDED_PYTHON_VERSION], { env, timeoutMs: 900_000 })
  if (installCode !== 0) fail("uv 安装 Python 失败，请检查网络能否访问 github.com（python-build-standalone），或设置 UV_PYTHON_INSTALL_MIRROR")
  fs.rmSync(venvDir, { recursive: true, force: true })
  const venvCode = await run(uv, ["venv", venvDir, "--python", EMBEDDED_PYTHON_VERSION, "--seed"], { env })
  if (venvCode !== 0 || !fs.existsSync(venvPython)) fail("uv 创建虚拟环境失败")
}

async function prepareVenv() {
  if (venvHealthy() && (await spawnPip())) {
    say(`复用已有虚拟环境：${venvDir}`)
    return
  }
  if (fs.existsSync(venvDir)) {
    say("已有虚拟环境无法使用（解释器失效或缺少 pip），重新创建")
    fs.rmSync(venvDir, { recursive: true, force: true })
  }

  const system = forceUv ? null : findPython(root, { skipProject: true })
  if (system) {
    say(`使用系统 Python ${system.version}（${[system.command, ...system.args].join(" ")}）创建虚拟环境：${venvDir}`)
    const code = await run(system.command, [...system.args, "-m", "venv", venvDir])
    if (code === 0 && fs.existsSync(venvPython) && (await pipWorks())) return
    say("系统 Python 无法创建可用的虚拟环境（常见原因：缺少 python3-venv / ensurepip），改用内置 Python")
    fs.rmSync(venvDir, { recursive: true, force: true })
  } else if (!forceUv) {
    say("未检测到可用的系统 Python 3.9+（已跳过 Windows 应用商店占位程序），改用内置 Python")
  }
  await createVenvWithUv()
  if (!(await spawnPip())) fail("内置 Python 虚拟环境中 pip 不可用")
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
  say(
    `模式：${
      light
        ? "light（仅帧差 motion-only，不安装 PyTorch）"
        : cpuOnly
          ? `完整安装（CPU 版 PyTorch${forceCpu ? "，已强制" : "，未检测到 NVIDIA GPU"}）`
          : `完整安装（${gpuDetected ? "检测到 NVIDIA GPU，" : ""}默认 PyTorch，含 CUDA 组件，体积较大）`
    }`
  )

  if (!light && isMusl()) {
    fail(
      "当前系统使用 musl libc（如 Alpine 镜像），PyTorch / ultralytics 没有对应的预编译包，无法安装完整视觉环境。" +
        "请改用基于 glibc 的镜像（如 node:20-bookworm-slim），或使用 --light 仅启用帧差预筛"
    )
  }

  const unwritable = [paths.home ?? pythonDir, paths.binDir, modelsDir, path.dirname(venvDir)]
    .map((dir) => checkWritableDir(dir))
    .filter(Boolean)
  if (unwritable.length > 0) {
    fail(
      `${unwritable.join("；")}。请给运行用户授予该目录的写权限，或设置 VIGIL_PYTHON_HOME 指向一个可写目录（Docker 下建议放在持久化卷内，如 /app/data/vision）`
    )
  }
  say(`视觉主目录：${paths.home ?? "(项目内置布局)"}；Python：${pythonDir}；虚拟环境：${venvDir}；权重：${modelsDir}`)

  await prepareVenv()

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
    say("安装 CLIP 文本编码器（YOLO-World 开放词汇所需）…")
    const clipCode = await pip(["ftfy", "regex", CLIP_PACKAGE], { timeoutMs: 600_000 })
    clipOk = clipCode === 0
    if (!clipOk) console.warn("[setup-vision] CLIP 安装失败：请确认能访问 github.com，随后重新运行本脚本")

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
