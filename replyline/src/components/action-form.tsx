"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";
import { Button, Notice } from "./ui";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * A form bound to a server action that shows the action's success or error
 * message inline. Works without JavaScript (progressive enhancement).
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  showSuccess = true,
  render,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  showSuccess?: boolean;
  /** Render extra output from the action's `data`, e.g. a generated link. */
  render?: (state: ActionState) => ReactNode;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state.error && (
        <div className="mt-3">
          <Notice tone="error">{state.error}</Notice>
        </div>
      )}
      {state.ok && showSuccess && state.message && (
        <div className="mt-3">
          <Notice tone="success">{state.message}</Notice>
        </div>
      )}
      {render?.(state)}
    </form>
  );
}

export function SubmitButton({ children, pendingText, variant, size, className, name, value, confirm }: {
  children: ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  name?: string;
  value?: string;
  /** Ask the browser to confirm before submitting (for destructive actions). */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      disabled={pending}
      aria-busy={pending}
      name={name}
      value={value}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingText ?? "Working…" : children}
    </Button>
  );
}
