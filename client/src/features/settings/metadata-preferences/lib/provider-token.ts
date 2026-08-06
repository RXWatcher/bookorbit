export function unwrapQuotedValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed
  const startsWithQuote = trimmed.startsWith('"') || trimmed.startsWith("'")
  const endsWithQuote = trimmed.endsWith('"') || trimmed.endsWith("'")
  if (!startsWithQuote || !endsWithQuote) return trimmed
  if (trimmed[0] !== trimmed[trimmed.length - 1]) return trimmed
  return trimmed.slice(1, -1).trim()
}

export function stripBearerPrefix(value: string): string {
  const normalized = unwrapQuotedValue(value)
  if (!normalized) return normalized
  const withoutPrefix = normalized.toLowerCase().startsWith('bearer ') ? normalized.slice(7).trim() : normalized
  return unwrapQuotedValue(withoutPrefix)
}
