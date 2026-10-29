import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Notice } from "@/components/ui";
import { isDevLike } from "@/lib/env";
import { signInAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-xl font-semibold text-ink-950">Sign in</h1>
      {isDevLike() && (
        <div className="mt-4">
          <Notice tone="info" title="Demo account">
            demo@replyline.test / demo-password-123 (after running <code>npm run db:seed</code>)
          </Notice>
        </div>
      )}
      <ActionForm action={signInAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <Field id="email" label="Email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field id="password" label="Password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm text-ink-600">
        New here? <Link href="/sign-up" className="font-medium text-brand-700">Create an account</Link>
      </p>
      <p className="mt-2 text-center text-xs text-ink-400">Forgotten your password? Contact support — self-service reset is on the roadmap.</p>
    </>
  );
}
