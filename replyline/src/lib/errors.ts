/**
 * Errors that are safe to show to the user. Anything else is logged server-side
 * and replaced with a generic message, so internals never leak to the browser.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: "unauthenticated" | "forbidden" | "not_found" | "invalid" | "limit" | "conflict" | "rate_limited" = "invalid",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class PlanLimitError extends AppError {
  constructor(message: string) {
    super(message, "limit");
  }
}

export function publicMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  // Log without request bodies or personal data.
  console.error("[error]", e instanceof Error ? `${e.name}: ${e.message}` : "unknown error");
  return "Something went wrong. Please try again.";
}
