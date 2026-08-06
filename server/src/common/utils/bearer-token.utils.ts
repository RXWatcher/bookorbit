export function unwrapQuotedValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const isQuote = first === '"' || first === "'";
  if (!isQuote || first !== last) return trimmed;
  return trimmed.slice(1, -1).trim();
}

export function stripBearerPrefix(token: string): string {
  const normalized = unwrapQuotedValue(token);
  if (!normalized) return normalized;
  const withoutPrefix = normalized.toLowerCase().startsWith('bearer ') ? normalized.slice('bearer '.length).trim() : normalized;
  return unwrapQuotedValue(withoutPrefix);
}

export function toBearerAuthorization(token: string): string {
  return `Bearer ${stripBearerPrefix(token)}`;
}
