import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ButtonLink, Notice } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { findInvite } from "@/modules/team/service";
import { acceptInviteAction } from "../../actions";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findInvite(token);
  if (!invite) {
    return <Notice tone="error" title="Invitation not valid">This link has expired or was already used. Ask for a new invitation.</Notice>;
  }
  const session = await getSession();
  const next = `/invite/${token}`;
  return (
    <>
      <h1 className="text-xl font-semibold text-ink-950">Join {invite.orgName}</h1>
      <p className="mt-1 text-sm text-ink-500">You&apos;ve been invited as {invite.role === "admin" ? "an admin" : "a team member"} ({invite.email}).</p>
      {session ? (
        <ActionForm action={acceptInviteAction} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <SubmitButton className="w-full">Accept invitation</SubmitButton>
        </ActionForm>
      ) : (
        <div className="mt-6 space-y-3">
          <ButtonLink href={`/sign-up?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invite.email)}`} className="w-full">Create an account</ButtonLink>
          <p className="text-center text-sm text-ink-600">
            Have one? <Link className="font-medium text-brand-700" href={`/sign-in?next=${encodeURIComponent(next)}`}>Sign in</Link>
          </p>
        </div>
      )}
    </>
  );
}
