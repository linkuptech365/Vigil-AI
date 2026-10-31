import * as React from "react"

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

export function highlightJson(source: string) {
  const nodes: React.ReactNode[] = []
  let last = 0
  let key = 0

  for (const match of source.matchAll(TOKEN)) {
    const index = match.index ?? 0
    if (index > last) nodes.push(source.slice(last, index))

    const [full, str, colon, literal] = match
    let className = "text-warning"
    if (str) className = colon ? "text-signal" : "text-success"
    else if (literal) className = "text-primary"

    if (str && colon) {
      nodes.push(
        <span key={key++} className={className}>
          {str}
        </span>,
        colon
      )
    } else {
      nodes.push(
        <span key={key++} className={className}>
          {full}
        </span>
      )
    }
    last = index + full.length
  }

  if (last < source.length) nodes.push(source.slice(last))
  return nodes
}
