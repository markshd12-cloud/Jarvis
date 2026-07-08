"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, SendIcon, XIcon } from "lucide-react";

import {
  assignMemberRoleAction,
  inviteMemberAction,
} from "@/app/(app)/empresas/users-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CompanyMemberRow, CompanyRole } from "@/lib/db/companies";

const selectClass =
  "h-9 rounded-md border border-input bg-popover px-3 text-sm text-popover-foreground shadow-xs outline-none [color-scheme:light_dark] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 [&>option]:bg-popover [&>option]:text-popover-foreground";

export function CompanyUsersManager({
  companyId,
  members,
  roles,
}: {
  companyId: string;
  members: CompanyMemberRow[];
  roles: CompanyRole[];
}) {
  const [inviting, setInviting] = useState(false);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Usuários ({members.length})
        </h2>
        {!inviting && (
          <Button type="button" size="sm" onClick={() => setInviting(true)}>
            <PlusIcon />
            Cadastrar usuário
          </Button>
        )}
      </div>

      {inviting && (
        <InviteForm
          companyId={companyId}
          roles={roles}
          onClose={() => setInviting(false)}
          onSent={() => {
            setInviting(false);
            router.refresh();
          }}
        />
      )}

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {members.map((member) => (
          <MemberRow key={member.id} member={member} roles={roles} />
        ))}
        {members.length === 0 && (
          <li className="px-4 py-6 text-sm text-muted-foreground">
            Nenhum usuário nesta empresa.
          </li>
        )}
      </ul>
    </div>
  );
}

function InviteForm({
  companyId,
  roles,
  onClose,
  onSent,
}: {
  companyId: string;
  roles: CompanyRole[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await inviteMemberAction({ companyId, email, roleId });
      if (res.error) setError(res.error);
      else onSent();
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium">Cadastrar usuário</h3>
          <p className="text-sm text-muted-foreground">
            Enviamos um convite por e-mail; a pessoa define a própria senha.
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Fechar"
          onClick={onClose}
          disabled={pending}
        >
          <XIcon />
        </Button>
      </div>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <Field className="flex-1">
          <FieldLabel htmlFor="invite-email">E-mail</FieldLabel>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="fulano@cppem.com.br"
          />
        </Field>
        <Field className="sm:w-56">
          <FieldLabel htmlFor="invite-role">Role</FieldLabel>
          <select
            id="invite-role"
            className={selectClass}
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <Button type="button" onClick={submit} disabled={pending || !email}>
          <SendIcon />
          {pending ? "Enviando..." : "Enviar convite"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  roles,
}: {
  member: CompanyMemberRow;
  roles: CompanyRole[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isSuperadmin = member.role === "superadmin";

  const changeRole = (roleId: string) => {
    startTransition(async () => {
      const res = await assignMemberRoleAction({ userId: member.id, roleId });
      if (res.error) window.alert(res.error);
      else router.refresh();
    });
  };

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm">{member.email || "(sem e-mail)"}</span>
        {isSuperadmin && (
          <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
            superadmin
          </span>
        )}
      </div>
      {isSuperadmin ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {member.roleName ?? "—"}
        </span>
      ) : (
        <select
          className={selectClass}
          value={member.roleId ?? ""}
          disabled={pending}
          onChange={(e) => changeRole(e.target.value)}
        >
          {member.roleId === null && <option value="">sem role</option>}
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}
