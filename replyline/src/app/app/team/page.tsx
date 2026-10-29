import { requireApp } from "@/lib/auth/session";
import { listMembers } from "@/modules/team/service";
import { getOrganization } from "@/modules/orgs/service";
import { effectivePlan } from "@/modules/billing/entitlements";
import { can } from "@/modules/auth/permissions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { formatInZone } from "@/lib/time";
import { inviteAction, teamAction } from "../actions";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const { actor } = await requireApp();
  const { members, invites, unassigned } = await listMembers(actor);
  const org = await getOrganization(actor);
  const plan = effectivePlan(org);
  const manage = can(actor.role, "team.manage");
  return (
    <>
      <PageHeader title="Team" description={`${members.length} of ${plan.limits.users} seats used on ${plan.name}. ${unassigned} open enquir${unassigned === 1 ? "y is" : "ies are"} unassigned.`} />
      <Card className="mb-6">
        <CardHeader title="Members and workload" />
        <Table>
          <thead className="bg-ink-50"><tr><Th>Name</Th><Th>Role</Th><Th>Open enquiries</Th><Th>Joined</Th>{manage && <Th />}</tr></thead>
          <tbody className="divide-y divide-ink-100">
            {members.map((m) => (
              <tr key={m.id}>
                <Td><div className="font-medium text-ink-900">{m.name}</div><div className="text-xs text-ink-500">{m.email}</div></Td>
                <Td>
                  {manage && m.userId !== actor.userId ? (
                    <ActionForm action={teamAction} className="flex gap-1">
                      <input type="hidden" name="op" value="role" />
                      <input type="hidden" name="membershipId" value={m.id} />
                      <label htmlFor={`role-${m.id}`} className="sr-only">Role</label>
                      <select id={`role-${m.id}`} name="role" defaultValue={m.role} className="h-8 rounded border-ink-300 text-sm">
                        {can(actor.role, "team.change_owner") && <option value="owner">Owner</option>}
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                      <SubmitButton size="sm" variant="ghost">Change</SubmitButton>
                    </ActionForm>
                  ) : <Badge>{m.role}</Badge>}
                </Td>
                <Td className="tabular-nums">{m.openEnquiries}</Td>
                <Td>{formatInZone(m.joinedAt, org.timezone, "date")}</Td>
                {manage && (
                  <Td>
                    {m.role !== "owner" && m.userId !== actor.userId && (
                      <ActionForm action={teamAction}>
                        <input type="hidden" name="op" value="remove" />
                        <input type="hidden" name="membershipId" value={m.id} />
                        <SubmitButton size="sm" variant="ghost" confirm={`Remove ${m.name}? Their enquiries become unassigned.`}>Remove</SubmitButton>
                      </ActionForm>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {manage && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Invite someone" description="Admins can manage templates, workflows and the team. Members work enquiries." />
            <ActionForm
              action={inviteAction}
              className="space-y-3 p-5"
              resetOnSuccess
              render={(s) => s.data?.link ? <code className="mt-2 block break-all rounded bg-ink-50 p-2 text-xs">{String(s.data.link)}</code> : null}
            >
              <Field id="email" label="Email"><Input id="email" name="email" type="email" required /></Field>
              <Field id="role" label="Role"><Select id="role" name="role" defaultValue="member"><option value="member">Member</option><option value="admin">Admin</option></Select></Field>
              <SubmitButton>Create invitation</SubmitButton>
            </ActionForm>
          </Card>
          <Card>
            <CardHeader title="Pending invitations" />
            {invites.length === 0 ? <p className="px-5 py-4 text-sm text-ink-500">None.</p> : (
              <ul className="divide-y divide-ink-100">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span>{i.email} · {i.role} · expires {formatInZone(i.expiresAt, org.timezone, "date")}</span>
                    <ActionForm action={teamAction}><input type="hidden" name="op" value="revoke" /><input type="hidden" name="inviteId" value={i.id} /><SubmitButton size="sm" variant="ghost">Revoke</SubmitButton></ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
