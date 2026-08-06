const MAX_LOG_VALUE_LENGTH = 200;

export function sanitizeLogValue(value: unknown, maxLength = MAX_LOG_VALUE_LENGTH): string {
  return String(value)
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, maxLength)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}
