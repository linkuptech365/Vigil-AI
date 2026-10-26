import fs from "node:fs"
import path from "node:path"

import type { RagDoc, RagIndexFile } from "@/lib/ops/rag-types"
import { dataDir } from "@/lib/storage/rules-store"

export function ragIndexPath() {
  return path.join(dataDir(), "rag", "index.json")
}

export function loadRagDocs(): RagDoc[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(ragIndexPath(), "utf8")) as Partial<RagIndexFile>
    return Array.isArray(parsed.docs) ? parsed.docs : []
  } catch {
    return []
  }
}

export function writeRagDocs(docs: RagDoc[]) {
  const file = ragIndexPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  const payload: RagIndexFile = { version: 1, docs }
  try {
    fs.writeFileSync(temp, JSON.stringify(payload), "utf8")
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}
