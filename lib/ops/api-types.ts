export interface ConnectionTestRequest {
  apiUrl: string
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
