import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

import { GMP_CASES, type GmpProvisionResponse, type GmpProvisionedCase } from "@/lib/ops/gmp-suite"
import { buildMp4 } from "@/lib/ops/server/mp4-builder"
import { listRules } from "@/lib/ops/server/rule-engine"
import { jsonError, jsonOk } from "@/lib/ops/server/rule-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SUITE_DIR_NAME = "vigil-test"

export async function POST() {
  const directory = path.join(os.tmpdir(), SUITE_DIR_NAME)

  try {
    await fs.mkdir(directory, { recursive: true })

    const cases: GmpProvisionedCase[] = []
    for (const gmpCase of GMP_CASES) {
      const filePath = path.join(directory, gmpCase.fileName)
      const content = buildMp4({
        durationSec: gmpCase.durationSec,
        width: gmpCase.width,
        height: gmpCase.height,
        sizeBytes: gmpCase.sizeKB * 1024,
        seed: gmpCase.fileName,
      })
      await fs.writeFile(filePath, content)
      cases.push({ ...gmpCase, path: filePath, sizeBytes: content.length })
    }

    const response: GmpProvisionResponse = {
      status: "success",
      suite: "vaccine-cleanroom-gmp",
      directory,
      cases,
      rules: listRules().filter((rule) => rule.id.startsWith("RULE-BIO-")),
      generatedAt: new Date().toISOString(),
      note: "样本文件携带真实的 mp4 容器头部（时长、分辨率），可被扫描接口解析；媒体数据为占位填充，不含可播放画面。",
    }
    return jsonOk(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误"
    return jsonError(500, "PROVISION_FAILED", `GMP 算例写入失败：${message}`)
  }
}
