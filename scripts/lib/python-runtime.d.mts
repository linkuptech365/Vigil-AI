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
