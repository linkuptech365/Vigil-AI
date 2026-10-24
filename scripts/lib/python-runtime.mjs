/**
 * Python 探测与内置 Python 引导（setup-vision 脚本与 Next 服务端共用）。
 *
 * 探测顺序：VIGIL_PYTHON ➔ 项目内置环境（视觉主目录 / .venv / .python）➔ python3 ➔ python ➔ py -3 ➔ 常见系统路径。
 * 每个候选都必须真正执行 `-c "import sys; print(...)"`，退出码为 0 且版本 >= 3.9 才算有效，
 * 这样 Windows 应用商店的 WindowsApps\python3.exe 空壳（退出码非 0 或只打印提示）会被直接跳过。
 *
 * 视觉主目录（visionPaths）：uv、内置 Python、虚拟环境、模型权重、各类缓存统一放在一个可写目录下。
 *   VIGIL_PYTHON_HOME            显式指定
 *   <VIGIL_DATA_DIR>/vision      未指定时取数据目录下的 vision（Docker 里即 /app/data/vision，命名卷持久化且已授权）
 *   都未设置                      回退到项目根下的 .python / services/vision-worker/.venv / models / bin（本地开发）
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const MIN_PYTHON = [3, 9]
export const EMBEDDED_PYTHON_VERSION = "3.11"

const isWin = process.platform === "win32"
const VERSION_SNIPPET = "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"

const exeIn = (dir, ...names) => names.map((name) => path.join(dir, name))
const venvBin = (venvDir) => path.join(venvDir, isWin ? "Scripts" : "bin", isWin ? "python.exe" : "python")

/**
 * 视觉环境涉及的全部目录。
 * home 为 null 表示走项目根下的传统布局；否则全部收敛到 home 下，运行用户只需对 home 有写权限。
 */
export function visionPaths(root) {
  const explicit = process.env.VIGIL_PYTHON_HOME?.trim()
  const dataDir = process.env.VIGIL_DATA_DIR?.trim()
  const home = explicit ? path.resolve(explicit) : dataDir ? path.resolve(dataDir, "vision") : null
  const envBin = process.env.VIGIL_BIN_DIR?.trim()
  const envModels = process.env.VIGIL_MODELS_DIR?.trim()
  if (!home) {
    const pythonDir = path.join(root, ".python")
    return {
      home: null,
      pythonDir,
      venvDir: path.join(root, "services", "vision-worker", ".venv"),
      uvCacheDir: path.join(pythonDir, ".uv-cache"),
      binDir: path.resolve(envBin || path.join(root, "bin")),
      modelsDir: path.resolve(envModels || path.join(root, "models")),
      cacheDir: null,
    }
  }
  return {
    home,
    pythonDir: path.join(home, "python"),
    venvDir: path.join(home, "venv"),
    uvCacheDir: path.join(home, "uv-cache"),
    binDir: path.resolve(envBin || path.join(home, "bin")),
    modelsDir: path.resolve(envModels || path.join(home, "models")),
    cacheDir: path.join(home, "cache"),
  }
}

/**
 * 子进程（pip / uv / vision-worker）使用的缓存目录环境变量。
 * 容器内运行用户的 HOME 往往不可写，PyTorch / HuggingFace / Ultralytics 默认写 ~/.cache 会失败，
 * 因此在使用视觉主目录时把它们全部重定向到 <home>/cache。
 */
export function visionRuntimeEnv(root) {
  const { cacheDir } = visionPaths(root)
  if (!cacheDir) return {}
  return {
    XDG_CACHE_HOME: cacheDir,
    PIP_CACHE_DIR: path.join(cacheDir, "pip"),
    TORCH_HOME: path.join(cacheDir, "torch"),
    HF_HOME: path.join(cacheDir, "huggingface"),
    YOLO_CONFIG_DIR: path.join(cacheDir, "ultralytics"),
    MPLCONFIGDIR: path.join(cacheDir, "matplotlib"),
  }
}

/** 创建目录并确认当前用户可写；不可写时返回人类可读的原因，可写返回 null */
export function checkWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.accessSync(dir, fs.constants.W_OK)
    return null
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : ""
    return `${dir} 不可写（${code || (error instanceof Error ? error.message : "未知错误")}）`
  }
}

function listDirs(parent, pattern) {
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
      .map((entry) => path.join(parent, entry.name))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

/** 项目内置环境：视觉主目录的 venv / python，以及传统位置（服务专用 .venv、项目根 .venv、.python）作为兼容 */
export function projectPythons(root) {
  const paths = visionPaths(root)
  const list = [
    venvBin(paths.venvDir),
    venvBin(path.join(root, "services", "vision-worker", ".venv")),
    venvBin(path.join(root, ".venv")),
  ]
  const installRoots = [...new Set([paths.pythonDir, path.join(root, ".python")])]
  for (const installRoot of installRoots) {
    list.push(...exeIn(path.join(installRoot, "bin"), "python3", "python"), path.join(installRoot, "python.exe"))
    for (const dir of listDirs(installRoot, /^cpython-/)) {
      list.push(...exeIn(path.join(dir, "bin"), "python3", "python"), path.join(dir, "python.exe"))
    }
  }
  return [...new Set(list)].filter((file) => fs.existsSync(file)).map((command) => ({ command, args: [], source: "project" }))
}

function systemPythons() {
  const list = []
  const home = os.homedir()
  if (isWin) {
    const local = process.env.LOCALAPPDATA
    const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean)
    if (local) {
      for (const dir of listDirs(path.join(local, "Programs", "Python"), /^Python3\d+/i)) list.push(path.join(dir, "python.exe"))
    }
    for (const base of programFiles) for (const dir of listDirs(base, /^Python3\d+/i)) list.push(path.join(dir, "python.exe"))
    for (const dir of listDirs("C:\\", /^Python3\d+/i)) list.push(path.join(dir, "python.exe"))
    for (const name of ["miniconda3", "anaconda3", "mambaforge", "miniforge3"]) {
      list.push(path.join(home, name, "python.exe"))
      if (local) list.push(path.join(local, name, "python.exe"))
      list.push(path.join("C:\\ProgramData", name, "python.exe"))
    }
  } else {
    list.push("/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/opt/python/libexec/bin/python", "/opt/conda/bin/python")
    for (const name of ["miniconda3", "anaconda3", "mambaforge", "miniforge3"]) list.push(path.join(home, name, "bin", "python"))
  }
  return [...new Set(list)].filter((file) => fs.existsSync(file)).map((command) => ({ command, args: [], source: "system-path" }))
}

/** 完整候选清单（尚未验证），按优先级排序 */
export function pythonCandidates(root, options = {}) {
  const list = []
  const explicit = process.env.VIGIL_PYTHON?.trim()
  if (explicit) list.push({ command: explicit, args: [], source: "env" })
  if (!options.skipProject) list.push(...projectPythons(root))
  list.push({ command: "python3", args: [], source: "path" }, { command: "python", args: [], source: "path" })
  if (isWin) list.push({ command: "py", args: ["-3"], source: "py-launcher" })
  list.push(...systemPythons())
  const seen = new Set()
  return list.filter((item) => {
    const key = `${item.command}\u0000${item.args.join(" ")}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 实际执行解释器并校验：退出码 0、输出形如 3.11、版本 >= 3.9；否则返回 null */
export function probePython(candidate) {
  try {
    const result = spawnSync(candidate.command, [...candidate.args, "-c", VERSION_SNIPPET], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    })
    if (result.error || result.status !== 0) return null
    const match = /^(\d+)\.(\d+)$/.exec((result.stdout ?? "").trim())
    if (!match) return null
    const major = Number(match[1])
    const minor = Number(match[2])
    if (major !== MIN_PYTHON[0] || minor < MIN_PYTHON[1]) return null
    return { ...candidate, version: `${major}.${minor}` }
  } catch {
    return null
  }
}

/** 依次探测，返回第一个有效解释器（含 command/args/version/source）；全部失败返回 null */
export function findPython(root, options = {}) {
  for (const candidate of pythonCandidates(root, options)) {
    const verified = probePython(candidate)
    if (verified) return verified
  }
  return null
}

/** 生成所有有效解释器（惰性），供引擎按"是否已装好依赖"继续筛选 */
export function* validPythons(root, options = {}) {
  for (const candidate of pythonCandidates(root, options)) {
    const verified = probePython(candidate)
    if (verified) yield verified
  }
}

/* ------------------------------------ uv ------------------------------------ */

const uvName = isWin ? "uv.exe" : "uv"
export const localUvPath = (root) => path.join(visionPaths(root).binDir, uvName)

function uvWorks(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10_000 })
  return !result.error && result.status === 0
}

/** 已有的 uv：项目 bin/uv ➔ PATH ➔ 常见安装位置 */
export function findUv(root) {
  const candidates = [
    localUvPath(root),
    path.join(root, "bin", uvName),
    "uv",
    path.join(os.homedir(), ".local", "bin", uvName),
    path.join(os.homedir(), ".cargo", "bin", uvName),
  ]
  return candidates.find((command) => (path.isAbsolute(command) ? fs.existsSync(command) : true) && uvWorks(command)) ?? null
}

/** Alpine 等 musl 发行版：PyTorch / ultralytics 没有 musllinux 预编译包，无法安装完整视觉环境 */
export function isMusl() {
  if (process.platform !== "linux") return false
  try {
    const header = process.report?.getReport?.().header
    return !header?.glibcVersionRuntime
  } catch {
    return false
  }
}

/** astral-sh/uv Releases 的资源名；不支持的平台返回 null */
export function uvAssetName() {
  const arch = process.arch
  if (process.platform === "win32") {
    const triple = { x64: "x86_64-pc-windows-msvc", arm64: "aarch64-pc-windows-msvc", ia32: "i686-pc-windows-msvc" }[arch]
    return triple ? `uv-${triple}.zip` : null
  }
  if (process.platform === "darwin") {
    const triple = { x64: "x86_64-apple-darwin", arm64: "aarch64-apple-darwin" }[arch]
    return triple ? `uv-${triple}.tar.gz` : null
  }
  if (process.platform === "linux") {
    const libc = isMusl() ? "musl" : "gnu"
    const triple = {
      x64: `x86_64-unknown-linux-${libc}`,
      arm64: `aarch64-unknown-linux-${libc}`,
      ia32: `i686-unknown-linux-${libc}`,
      arm: libc === "musl" ? "armv7-unknown-linux-musleabihf" : "armv7-unknown-linux-gnueabihf",
    }[arch]
    return triple ? `uv-${triple}.tar.gz` : null
  }
  return null
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const found = findFile(full, name)
      if (found) return found
    }
  }
  return null
}

/**
 * 下载 uv 单文件二进制到 <root>/bin/uv(.exe)，返回可执行路径。
 * 镜像：VIGIL_UV_DOWNLOAD_BASE（默认 https://github.com/astral-sh/uv/releases/latest/download）
 */
export async function ensureUv(root, say = () => {}) {
  const existing = findUv(root)
  if (existing) {
    say(`使用已有 uv：${existing}`)
    return existing
  }
  const asset = uvAssetName()
  if (!asset) throw new Error(`当前平台 ${process.platform}-${process.arch} 没有预编译的 uv，请手动安装 Python 3.9+ 或 uv`)
  const base = (process.env.VIGIL_UV_DOWNLOAD_BASE?.trim() || "https://github.com/astral-sh/uv/releases/latest/download").replace(/\/$/, "")
  const url = `${base}/${asset}`
  const target = localUvPath(root)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "vigil-uv-"))
  try {
    say(`未检测到可用的系统 Python，自动下载 uv：${url}`)
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(300_000) })
    if (!response.ok) throw new Error(`下载 uv 失败（HTTP ${response.status}）`)
    const archive = path.join(work, asset)
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
    // Windows 10+ 自带的 bsdtar 同样能解压 zip
    const extract = spawnSync("tar", ["-xf", archive, "-C", work], { encoding: "utf8", windowsHide: true, timeout: 120_000 })
    if (extract.error || extract.status !== 0) throw new Error(`解压 uv 失败：${extract.error?.message ?? extract.stderr?.trim() ?? "tar 退出码非 0"}`)
    const binary = findFile(work, uvName)
    if (!binary) throw new Error("压缩包中没有找到 uv 可执行文件")
    fs.copyFileSync(binary, target)
    if (!isWin) fs.chmodSync(target, 0o755)
    if (!uvWorks(target)) throw new Error("下载的 uv 无法运行（平台或 libc 不匹配）")
    say(`uv 已安装到 ${target}`)
    return target
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

/** uv 管理的独立 Python 与缓存统一放在视觉主目录（或项目内 .python），不污染系统，也不依赖 /app 本身可写 */
export function uvEnv(root) {
  const paths = visionPaths(root)
  return {
    ...process.env,
    ...visionRuntimeEnv(root),
    UV_PYTHON_INSTALL_DIR: paths.pythonDir,
    UV_PYTHON_BIN_DIR: path.join(paths.pythonDir, "bin"),
    UV_CACHE_DIR: process.env.UV_CACHE_DIR || paths.uvCacheDir,
  }
}

/** NVIDIA 驱动可用则判定为 GPU 主机（据此选择 CUDA 版 PyTorch） */
export function hasNvidiaGpu() {
  const result = spawnSync("nvidia-smi", ["-L"], { encoding: "utf8", windowsHide: true, timeout: 8_000 })
  return !result.error && result.status === 0 && /GPU \d+/.test(result.stdout ?? "")
}
