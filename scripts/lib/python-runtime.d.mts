export interface PythonCandidate {
  command: string
  args: string[]
  source: string
}
export interface VerifiedPython extends PythonCandidate {
  version: string
}

export const MIN_PYTHON: number[]
export const EMBEDDED_PYTHON_VERSION: string

export interface VisionPaths {
  /** null 表示使用项目根下的传统布局 */
  home: string | null
  pythonDir: string
  venvDir: string
  uvCacheDir: string
  binDir: string
  modelsDir: string
  /** 仅在使用视觉主目录时有值 */
  cacheDir: string | null
}
export function visionPaths(root: string): VisionPaths
export function visionRuntimeEnv(root: string): Record<string, string>
export function checkWritableDir(dir: string): string | null
export function isMusl(): boolean

export function projectPythons(root: string): PythonCandidate[]
export function pythonCandidates(root: string, options?: { skipProject?: boolean }): PythonCandidate[]
export function probePython(candidate: PythonCandidate): VerifiedPython | null
export function findPython(root: string, options?: { skipProject?: boolean }): VerifiedPython | null
export function validPythons(root: string, options?: { skipProject?: boolean }): Generator<VerifiedPython>

export function localUvPath(root: string): string
export function findUv(root: string): string | null
export function uvAssetName(): string | null
export function ensureUv(root: string, say?: (message: string) => void): Promise<string>
export function uvEnv(root: string): NodeJS.ProcessEnv
export function hasNvidiaGpu(): boolean
