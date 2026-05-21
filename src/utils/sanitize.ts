const SENSITIVE_KEYS = ["authorization", "token", "password", "secret", "api_key", "apikey"];

export function sanitizeObject(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(sanitizeObject);
  }
  if (input && typeof input === "object") {
    const entries = Object.entries(input as Record<string, unknown>).map(([key, value]) => {
      if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
        return [key, "[REDACTED]"];
      }
      return [key, sanitizeObject(value)];
    });
    return Object.fromEntries(entries);
  }
  return input;
}
