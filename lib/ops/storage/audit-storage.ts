import type {
  AuditSnapshot,
  CapaFormState,
  CapaStatus,
  DeviationClass,
  GmpDeviationRecord,
} from "../audit-types"
import type { InspectionRule } from "../rules-types"
import { createSeedSnapshot, SERVER_SNAPSHOT } from "./audit-seed"

export const STORAGE_KEYS = {
  dossiers: "vigil_dossiers_v1",
  capa: "vigil_capa_records_v1",
  rules: "vigil_rules_state",
} as const

const CLASSES: readonly DeviationClass[] = ["CRITICAL", "MAJOR", "MINOR"]
const STATUSES: readonly CapaStatus[] = ["DRAFT", "IN_PROGRESS", "QA_REVIEW", "APPROVED"]

const memoryFallback = new Map<string, string>()
let storageAvailable: boolean | null = null

function canUseStorage() {
  if (typeof window === "undefined") return false
  if (storageAvailable !== null) return storageAvailable
  try {
    const probe = "__vigil_probe__"
    window.localStorage.setItem(probe, "1")
    window.localStorage.removeItem(probe)
    storageAvailable = true
  } catch {
    storageAvailable = false
  }
  return storageAvailable
}

function readRaw(key: string): string | null {
  if (canUseStorage()) {
    try {
      return window.localStorage.getItem(key)
    } catch {
      storageAvailable = false
    }
  }
  return memoryFallback.get(key) ?? null
}

function writeRaw(key: string, value: string) {
  memoryFallback.set(key, value)
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    storageAvailable = false
  }
}

function readJson(key: string): unknown {
  const raw = readRaw(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isDeviationRecord(value: unknown): value is GmpDeviationRecord {
  if (!isObject(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.channelId === "string" &&
    typeof value.sha256 === "string" &&
    typeof value.clipStartSec === "number" &&
    typeof value.clipEndSec === "number" &&
    CLASSES.includes(value.classification as DeviationClass) &&
    STATUSES.includes(value.capaStatus as CapaStatus) &&
    Array.isArray(value.auditLog)
  )
}

function isCapaForm(value: unknown): value is CapaFormState {
  return isObject(value) && typeof value.deviationId === "string" && typeof value.rcaCategory === "string"
}

function loadSnapshot(): AuditSnapshot {
  const seed = createSeedSnapshot()
  const storedRecords = readJson(STORAGE_KEYS.dossiers)
  const storedCapa = readJson(STORAGE_KEYS.capa)

  const records =
    Array.isArray(storedRecords) && storedRecords.length > 0 && storedRecords.every(isDeviationRecord)
      ? storedRecords
      : null

  const capa: Record<string, CapaFormState> = {}
  if (isObject(storedCapa)) {
    for (const [id, form] of Object.entries(storedCapa)) {
      if (isCapaForm(form)) capa[id] = form
    }
  }

  if (!records) {
    writeRaw(STORAGE_KEYS.dossiers, JSON.stringify(seed.records))
    writeRaw(STORAGE_KEYS.capa, JSON.stringify(seed.capa))
    return seed
  }

  for (const record of records) {
    if (!capa[record.id]) capa[record.id] = seed.capa[record.id] ?? createEmptyCapa(record.id)
  }
  return { records, capa }
}

export function createEmptyCapa(deviationId: string): CapaFormState {
  return {
    deviationId,
    rcaCategory: "HUMAN_ERROR",
    rcaNotes: "",
    containment: "",
    capaPlan: "",
    plannedDate: "",
    qaOfficer: "",
    signedAt: null,
    returnReason: null,
    updatedAt: new Date().toISOString(),
  }
}

let cache: AuditSnapshot | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function commit(next: AuditSnapshot) {
  cache = next
  writeRaw(STORAGE_KEYS.dossiers, JSON.stringify(next.records))
  writeRaw(STORAGE_KEYS.capa, JSON.stringify(next.capa))
  emit()
}

export function getAuditSnapshot(): AuditSnapshot {
  if (!cache) cache = loadSnapshot()
  return cache
}

/** Stable seed used for server rendering and the first hydration pass. */
export function getServerAuditSnapshot(): AuditSnapshot {
  return SERVER_SNAPSHOT
}

export function subscribeAudit(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEYS.dossiers && event.key !== STORAGE_KEYS.capa) return
    cache = null
    listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

interface CapaUpdate {
  deviationId: string
  form: CapaFormState
  status: CapaStatus
  actor: string
  action: string
}

export function applyCapaUpdate({ deviationId, form, status, actor, action }: CapaUpdate) {
  const current = getAuditSnapshot()
  const now = new Date().toISOString()
  const records = current.records.map((record) =>
    record.id === deviationId
      ? {
          ...record,
          capaStatus: status,
          auditLog: [
            ...record.auditLog,
            { id: `L-${deviationId.slice(-3)}-${record.auditLog.length + 1}`, at: now, actor, action },
          ],
        }
      : record
  )
  commit({ records, capa: { ...current.capa, [deviationId]: { ...form, updatedAt: now } } })
}

export function loadStoredRules(): InspectionRule[] | null {
  const stored = readJson(STORAGE_KEYS.rules)
  if (!Array.isArray(stored)) return null
  const valid = stored.filter(
    (item): item is InspectionRule =>
      isObject(item) && typeof item.id === "string" && typeof item.name === "string" && typeof item.type === "string"
  )
  return valid
}

export function saveStoredRules(rules: InspectionRule[]) {
  writeRaw(STORAGE_KEYS.rules, JSON.stringify(rules))
}
