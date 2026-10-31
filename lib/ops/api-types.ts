export interface ConnectionTestRequest {
  /** 传入后由服务端读取该档案的 URL / Key / 模型名，Key 不经过浏览器 */
  modelProfileId?: string
  apiUrl?: string
  apiKey?: string
  modelName?: string
}

export interface ConnectionTestResponse {
  status: "success" | "error"
  rttMs: number
  modelDetected: string
  endpoint: string
  message: string
  timestamp: string
}

export interface HealthResponse {
  status: "healthy"
  service: string
  version: string
  timestamp: number
  uptime: number
}
