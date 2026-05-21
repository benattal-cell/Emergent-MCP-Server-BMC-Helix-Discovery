import { sanitizeObject } from "./sanitize.js";

export interface NormalizedApiError {
  error: true;
  status?: number;
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  status?: number;
  code: string;
  details?: unknown;

  constructor(message: string, options: { status?: number; code: string; details?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

export function normalizeApiError(error: unknown): NormalizedApiError {
  if (error instanceof ApiError) {
    return {
      error: true,
      status: error.status,
      code: error.code,
      message: error.message,
      details: sanitizeObject(error.details)
    };
  }

  if (error instanceof Error) {
    return {
      error: true,
      code: "UNEXPECTED_ERROR",
      message: error.message
    };
  }

  return {
    error: true,
    code: "UNKNOWN_ERROR",
    message: "Unknown error",
    details: sanitizeObject(error)
  };
}
