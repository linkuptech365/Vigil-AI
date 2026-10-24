export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { ensureEngine } = await import("@/lib/stream-engine")
  const { ensureVisionEngine } = await import("@/lib/vision-engine")
  const { startStreamPatrol } = await import("@/lib/stream-patrol")
  // 不阻塞服务启动；失败时由控制台的引擎状态徽章给出修复提示
  void ensureEngine().catch((error) => console.error("[stream-engine] 启动失败：", error))
  void ensureVisionEngine().catch((error) => console.error("[vision-engine] 启动失败：", error))
  startStreamPatrol()
}
