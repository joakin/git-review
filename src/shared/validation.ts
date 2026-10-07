/** Generic checks for data before it crosses into typed application code. */
export function isValidUrlEncoding(value: string): boolean {
  try {
    // URLSearchParams silently replaces malformed Unicode; check before parsing.
    encodeURIComponent(decodeURIComponent(value));
    return true;
  } catch {
    return false;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Expected ${label} to be an object`);
  return value;
}

export function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Expected ${label} to be a string`);
  return value;
}

export function expectNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Expected ${label} to be a nonnegative integer`);
  }
  return value;
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error["code"] === code;
}
