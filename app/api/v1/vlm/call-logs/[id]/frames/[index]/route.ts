import { readVlmFrame } from "@/lib/storage/vlm-call-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params
  const frame = readVlmFrame(id, Number(index))
  if (!frame) return new Response("Not Found", { status: 404 })
  return new Response(new Uint8Array(frame.buffer), {
    headers: { "Content-Type": frame.mime, "Cache-Control": "private, max-age=3600" },
  })
}
