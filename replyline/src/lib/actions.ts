import "server-only";
import { ZodError } from "zod";
import { unstable_rethrow } from "next/navigation";
import { publicMessage } from "./errors";

/** What every form action returns to the ActionForm component. */
export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Arbitrary payload for forms that show a result (e.g. an invite link). */
  data?: Record<string, unknown>;
}

/** Wrap a server action so validation and app errors come back as messages, not crashes. */
export async function attempt(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let redirect()/notFound() through
    if (e instanceof ZodError) return { error: e.issues.map((i) => i.message).join(" · ") };
    return { error: publicMessage(e) };
  }
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
export const num = (fd: FormData, k: string) => Number(str(fd, k));
