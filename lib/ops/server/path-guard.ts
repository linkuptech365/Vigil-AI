import { promises as fs, type Stats } from "node:fs"
import os from "node:os"
import path from "node:path"

export class PathGuardError extends Error {
  constructor(
    public readonly httpStatus: 400 | 403 | 404,
    message: string
  ) {
    super(message)
  }
}

const MAX_PATH_LENGTH = 1024

function configuredRoots(): string[] {
  const extra = (process.env.VIGIL_ALLOWED_ROOTS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
  return [process.cwd(), os.tmpdir(), ...extra].map((root) => path.resolve(root))
}

function isInside(root: string, target: string) {
  const rel = path.relative(root, target)
  if (rel === "") return true
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

async function realRoots(): Promise<string[]> {
  const out: string[] = []
  for (const root of configuredRoots()) {
    try {
      out.push(await fs.realpath(root))
    } catch {
      // 不存在的根目录直接忽略
    }
  }
  return out
}

export interface SafePath {
  resolved: string
  stat: Stats
}

/**
 * 校验并解析客户端提交的物理路径：
 * 1. 拒绝空值 / 空字节 / 含 `..` 跳转片段
 * 2. 词法归一化后必须落在允许根目录内（项目目录、系统临时目录、VIGIL_ALLOWED_ROOTS）
 * 3. realpath 之后再次校验，防止符号链接逃逸
 */
export async function resolveSafePath(input: unknown, kind: "dir" | "file"): Promise<SafePath> {
  if (typeof input !== "string") throw new PathGuardError(400, "路径参数必须是字符串")
  const raw = input.trim()
  if (!raw || raw.length > MAX_PATH_LENGTH || raw.includes("\0")) {
    throw new PathGuardError(400, "路径参数无效")
  }
  if (raw.split(/[\\/]+/).includes("..")) {
    throw new PathGuardError(400, "路径包含非法的上级目录跳转 (..)")
  }

  const resolved = path.resolve(raw)
  const notAllowed = new PathGuardError(
    403,
    "该路径不在允许的扫描范围内。可使用 ./ 项目目录或 /tmp，或通过环境变量 VIGIL_ALLOWED_ROOTS 追加授权目录。"
  )
  if (!configuredRoots().some((root) => isInside(root, resolved))) throw notAllowed

  const missing = new PathGuardError(
    404,
    kind === "dir" ? "指定物理文件夹不存在或无访问权限" : "指定视频文件不存在或无访问权限"
  )

  let real: string
  try {
    real = await fs.realpath(resolved)
  } catch {
    throw missing
  }
  const roots = await realRoots()
  if (!roots.some((root) => isInside(root, real))) throw notAllowed

  let stat: Stats
  try {
    stat = await fs.stat(real)
  } catch {
    throw missing
  }
  if (kind === "dir" && !stat.isDirectory()) throw new PathGuardError(400, "指定路径不是文件夹")
  if (kind === "file" && !stat.isFile()) throw new PathGuardError(400, "指定路径不是视频文件")

  return { resolved: real, stat }
}
