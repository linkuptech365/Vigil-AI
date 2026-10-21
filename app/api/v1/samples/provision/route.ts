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

/** 按优先级查找随项目发布的有效 H.264 MP4，算例直接复制它们，保证浏览器可以解码播放。 */
const SOURCE_DIRS = ["public/videos", "public/ops/video"]

async function listSourceClips(): Promise<string[]> {
  for (const relative of SOURCE_DIRS) {
    const dir = path.join(process.cwd(), relative)
    try {
      const names = (await fs.readdir(dir))
        .filter((name) => name.toLowerCase().endsWith(".mp4"))
        .sort()
      if (names.length > 0) return names.map((name) => path.join(dir, name))
    } catch {
      // 目录不存在时继续尝试下一个
    }
  }
  return []
}

export async function POST() {
  const directory = path.join(os.tmpdir(), SUITE_DIR_NAME)

  try {
    await fs.mkdir(directory, { recursive: true })
    const clips = await listSourceClips()

    const cases: GmpProvisionedCase[] = []
    let playableCount = 0
    for (const [index, gmpCase] of GMP_CASES.entries()) {
      const filePath = path.join(directory, gmpCase.fileName)
      if (clips.length > 0) {
        // copyFile 逐字节复制，不经过任何文本处理，不会损坏二进制内容
        await fs.copyFile(clips[index % clips.length], filePath)
        playableCount += 1
      } else {
        await fs.writeFile(
          filePath,
          buildMp4({
            durationSec: gmpCase.durationSec,
            width: gmpCase.width,
            height: gmpCase.height,
            sizeBytes: gmpCase.sizeKB * 1024,
            seed: gmpCase.fileName,
          })
        )
      }
      const stat = await fs.stat(filePath)
      cases.push({ ...gmpCase, path: filePath, sizeBytes: stat.size })
    }

    const response: GmpProvisionResponse = {
      status: "success",
      suite: "vaccine-cleanroom-gmp",
      directory,
      cases,
      rules: listRules().filter((rule) => rule.id.startsWith("RULE-BIO-")),
      generatedAt: new Date().toISOString(),
      playable: playableCount === GMP_CASES.length,
      note:
        playableCount === GMP_CASES.length
          ? `4 个算例已从项目内置的有效 H.264 MP4 复制生成，可在浏览器中直接播放；时长与分辨率以文件真实元数据为准。`
          : "未找到可复制的内置 MP4，已回退为仅含容器头部的占位文件：可被扫描，但无法解码播放。",
    }
    return jsonOk(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误"
    return jsonError(500, "PROVISION_FAILED", `GMP 算例写入失败：${message}`)
  }
}
