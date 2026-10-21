import path from "node:path"

import { extraRoots, normalizeRawPath, PathGuardError, resolveSafePath, type SafePath } from "./path-guard"

export interface LocatedVideo extends SafePath {
  requested: string
  /** 命中的候选在查找顺序中的序号（0 起）。 */
  matchedIndex: number
}

function lastSegment(input: string) {
  return input.split(/[\\/]+/).filter(Boolean).pop() ?? input
}

/**
 * 按优先级生成候选物理路径：
 * 1. 绝对路径本身
 * 2. 相对工程根目录解析
 * 3. 工程根目录/vidso/<文件名>
 * 4. 工程根目录/public/videos/<文件名>
 * 5. VIGIL_ALLOWED_ROOTS / VIGIL_SCAN_DIR 各根目录下的相对路径与文件名
 */
export function buildVideoCandidates(requested: string): string[] {
  const cwd = process.cwd()
  const name = lastSegment(requested)
  const list: string[] = []

  if (path.isAbsolute(requested)) list.push(path.normalize(requested))
  list.push(path.resolve(cwd, requested))
  list.push(path.resolve(cwd, "vidso", name))
  list.push(path.resolve(cwd, "public", "videos", name))
  for (const root of extraRoots()) {
    if (!path.isAbsolute(requested)) list.push(path.resolve(root, requested))
    list.push(path.resolve(root, name))
  }
  return [...new Set(list)]
}

/**
 * 在候选路径中找到第一个「存在、是文件、且 realpath 后仍在允许根目录内」的视频。
 * 每个候选都完整经过 path-guard 校验，因此智能补全不会绕过白名单或符号链接防护。
 * 全部未命中时：任一候选被拒绝则返回 403，其次 400，否则 404。
 */
export async function locateVideo(input: unknown): Promise<LocatedVideo> {
  const requested = normalizeRawPath(input)
  const candidates = buildVideoCandidates(requested)

  let forbidden: PathGuardError | null = null
  let invalid: PathGuardError | null = null

  for (const [index, candidate] of candidates.entries()) {
    try {
      const safe = await resolveSafePath(candidate, "file")
      return { ...safe, requested, matchedIndex: index }
    } catch (error) {
      if (!(error instanceof PathGuardError)) throw error
      if (error.httpStatus === 403) forbidden ??= error
      else if (error.httpStatus === 400) invalid ??= error
    }
  }

  if (forbidden) throw forbidden
  if (invalid) throw invalid
  throw new PathGuardError(
    404,
    `指定视频文件不存在或无访问权限（已按 ${candidates.length} 个候选位置查找：原路径、工程根目录、vidso、public/videos、授权根目录）`
  )
}
