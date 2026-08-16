const REDACTED = '[REDACTED]';
const secretKeys = /authorization|cookie|password|secret|token|api[-_]?key|body/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretKeys.test(key) ? REDACTED : redact(item),
      ]),
    );
  return value;
}
