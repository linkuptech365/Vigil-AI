/**
 * 视频路径清洗（前后端共用，不依赖 node:path）。
 * 前端 UI 会给路径加显示标签，例如 "[本机] vidso/a.mp4"、"[Local Directory]/a.mp4"，
 * 这些标签不是文件系统的一部分，必须在寻址前剥离。
 */

/** 开头的方括号标签：标签后紧跟分隔符则连同分隔符一起去掉，否则只去掉空白（保留 "[本机] /abs/a.mp4" 的绝对路径语义）。 */
const UI_LABEL_PREFIX = /^\[[^\]]+\](?:[\\/]+|\s*)/

export function sanitizeVideoPath(raw: string): { cleanedPath: string; fileName: string } {
  if (!raw) return { cleanedPath: "", fileName: "" }

  let cleaned = raw.trim()
  // 标签可能叠加（如 "[本机] [vidso] a.mp4"），循环剥离
  while (UI_LABEL_PREFIX.test(cleaned)) cleaned = cleaned.replace(UI_LABEL_PREFIX, "").trim()
  cleaned = cleaned.replace(/\\/g, "/")

  const fileName = cleaned.split("/").filter(Boolean).pop() ?? ""
  return { cleanedPath: cleaned, fileName }
}

/** 前端发给后端的 videoPath：剥离 UI 标签，没有路径时退回纯文件名。 */
export function toRequestVideoPath(video: { path?: string | null; name: string }): string {
  return sanitizeVideoPath(video.path ?? "").cleanedPath || video.name
}
