// Drizzle wraps the driver error, so the pg error (with its SQLSTATE `code`)
// lives on `.cause`. These helpers walk the cause chain to find it.

function findPgError(err: unknown): { code?: string; message?: string } | null {
  let current: unknown = err;
  for (let i = 0; i < 5 && current; i++) {
    if (typeof current === "object" && current !== null && "code" in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string") return current as { code: string; message?: string };
    }
    current = (current as { cause?: unknown })?.cause;
  }
  return null;
}

/** SQLSTATE code of a (possibly wrapped) pg error, or null. */
export function pgErrorCode(err: unknown): string | null {
  return findPgError(err)?.code ?? null;
}

/** Unique-constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}

/**
 * The RAISE message from one of our engine triggers, if this error came from
 * one (SQLSTATE P04xx). Lets the UI show the friendly reason ("Period … is
 * locked") instead of a raw "Failed query" string.
 */
export function triggerMessage(err: unknown): string | null {
  const pgErr = findPgError(err);
  if (pgErr?.code && pgErr.code.startsWith("P04") && pgErr.message) return pgErr.message;
  return null;
}

/**
 * Best available message for ANY database error. Drizzle's own `.message` is
 * the full parameterised SQL plus every bound value — never show that to a
 * user (it is noise, and it leaks data). Prefer the driver's message.
 */
export function dbErrorMessage(err: unknown): string | null {
  const pgErr = findPgError(err);
  if (!pgErr?.message) return null;
  return pgErr.code ? `${pgErr.message} (SQLSTATE ${pgErr.code})` : pgErr.message;
}
