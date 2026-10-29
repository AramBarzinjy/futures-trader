import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { signUpAction } from "../actions";

export const metadata = { title: "Create your account" };

export default async function SignUp({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-xl font-semibold text-ink-950">Start your free trial</h1>
      <p className="mt-1 text-sm text-ink-500">14 days of Growth. No card needed.</p>
      <ActionForm action={signUpAction} className="mt-6 space-y-4">
        <input type="hidden" name="industry" value={sp.industry ?? ""} />
        <input type="hidden" name="plan" value={sp.plan ?? ""} />
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <Field id="name" label="Your name">
          <Input id="name" name="name" autoComplete="name" required />
        </Field>
        <Field id="email" label="Work email">
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={sp.email} />
        </Field>
        <Field id="password" label="Password" hint="(10+ characters)">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <SubmitButton className="w-full" pendingText="Creating account…">Create account</SubmitButton>
        <p className="text-xs text-ink-500">
          By creating an account you agree to the <Link className="underline" href="/legal/terms">terms</Link> and <Link className="underline" href="/legal/privacy">privacy policy</Link>.
        </p>
      </ActionForm>
      <p className="mt-6 text-center text-sm text-ink-600">
        Already have an account? <Link href="/sign-in" className="font-medium text-brand-700">Sign in</Link>
      </p>
    </>
  );
}
