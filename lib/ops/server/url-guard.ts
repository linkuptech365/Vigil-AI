const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
const GATEWAY_PORT = process.env.PORT ?? "3000"
const PRIVATE_IPV4 = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/

export function isBlockedHost(hostname: string) {
  return (
    hostname.startsWith("169.254.") ||
    hostname === "metadata.google.internal" ||
    hostname === "[fd00:ec2::254]"
  )
}

/** 本机或内网部署的模型服务（Ollama / vLLM）通常不需要 API Key。 */
export function isLocalHost(hostname: string) {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".local") || PRIVATE_IPV4.test(hostname)
}

export function isGatewayItself(url: URL, requestHost: string | null) {
  const port = url.port || (url.protocol === "https:" ? "443" : "80")
  const onLoopbackPort = LOOPBACK_HOSTS.has(url.hostname) && port === GATEWAY_PORT
  return onLoopbackPort || (requestHost !== null && url.host === requestHost)
}
