const SENSITIVE_KEYS = ["token", "secret", "password", "authorization", "cookie", "api_key", "apikey", "key"];

export function sanitizeObject(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(sanitizeObject);
  }

  if (input && typeof input === "object") {
    const entries = Object.entries(input as Record<string, unknown>).map(([key, value]) => {
      if (SENSITIVE_KEYS.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey))) {
        return [key, "[REDACTED]"];
      }
      return [key, sanitizeObject(value)];
    });
    return Object.fromEntries(entries);
  }

  return input;
}

export function sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, unknown> {
  return sanitizeObject(headers) as Record<string, unknown>;
}
