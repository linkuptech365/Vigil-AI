import { NextResponse } from "next/server"

import type { ApiErrorBody } from "@/lib/ops/rules-api-types"

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

const NO_STORE = { "Cache-Control": "no-store" }

export function jsonOk<T>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export function jsonError(status: number, code: string, error: string) {
  const body: ApiErrorBody = { error, code }
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function readJsonBody(request: Request): Promise<Parsed<Record<string, unknown>>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, message: "请求体不是合法的 JSON" }
  }
  if (!isRecord(raw)) return { ok: false, message: "请求体必须是 JSON 对象" }
  return { ok: true, value: raw }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  maxLength: number
): Parsed<string | undefined> {
  const value = body[field]
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (typeof value !== "string") return { ok: false, message: `${field} 必须是字符串` }
  if (value.length > maxLength) return { ok: false, message: `${field} 不能超过 ${maxLength} 个字符` }
  return { ok: true, value }
}

export function requiredString(body: Record<string, unknown>, field: string, maxLength: number): Parsed<string> {
  const parsed = optionalString(body, field, maxLength)
  if (!parsed.ok) return parsed
  const value = parsed.value?.trim()
  if (!value) return { ok: false, message: `${field} 为必填项` }
  return { ok: true, value }
}

export function optionalNumber(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number
): Parsed<number | undefined> {
  const value = body[field]
  if (value === undefined || value === null) return { ok: true, value: undefined }
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, message: `${field} 必须是数字` }
  if (value < min || value > max) return { ok: false, message: `${field} 必须在 ${min} 到 ${max} 之间` }
  return { ok: true, value }
}

export function optionalCoords(
  body: Record<string, unknown>,
  field: string
): Parsed<[number, number] | undefined> {
  const value = body[field]
  if (value === undefined || value === null) return { ok: true, value: undefined }
  const valid =
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1000)
  if (!valid) return { ok: false, message: `${field} 必须是 [x, y]，取值范围 0~1000` }
  return { ok: true, value: [value[0], value[1]] }
}

export function optionalTimestamp(body: Record<string, unknown>, field: string): Parsed<string | undefined> {
  const parsed = optionalString(body, field, 64)
  if (!parsed.ok) return parsed
  if (parsed.value !== undefined && Number.isNaN(Date.parse(parsed.value))) {
    return { ok: false, message: `${field} 不是合法的 ISO 8601 时间` }
  }
  return parsed
}
