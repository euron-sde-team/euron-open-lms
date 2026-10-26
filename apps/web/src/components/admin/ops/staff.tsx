"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCog, UserPlus } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, Skeleton, cn, toast } from "@open-lms/ui";
import type { AdminUserRow, StaffRow, UserRole } from "@open-lms/types";
import { api } from "@/lib/api";
import { ROLE_HELP, ROLE_LABEL, STAFF_ROLES, STATUS_LABEL, STATUS_TONE, shortDate } from "@/lib/admin-ops";
import { useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { UserAvatar } from "@/components/common/user-bits";
import { AdminPage, DataTable, FilterBar, SearchInput, pagedTable, useUrlState, type Column } from "../shell";

type RoleTab = "all" | (typeof STAFF_ROLES)[number];
const TABS: { value: RoleTab; label: string }[] = [{ value: "all", label: "Everyone" }, ...STAFF_ROLES.map((r) => ({ value: r, label: `${ROLE_LABEL[r]}s` }))];
const ROLE_OPTIONS = (["LEARNER", ...STAFF_ROLES] as UserRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }));

interface Change {
  user: { id: string; displayName: string; role: UserRole };
  to: UserRole;
}

export function AdminStaff() {
  const me = useMe();
  const url = useUrlState();
  const qc = useQueryClient();
  const q = url.get("q");
  const role = (TABS.some((t) => t.value === url.get("role")) ? url.get("role") : "all") as RoleTab;
  const [change, setChange] = useState<Change | null>(null);
  const [adding, setAdding] = useState(false);
  const list = usePagedList<StaffRow>({
    queryKey: qk.admin.list("staff", { q, role }),
    fetchPage: (cursor) => api().admin.staff({ q: q || undefined, role: role === "all" ? undefined : role, cursor, limit: 50 }),
  });

  const columns = useMemo<Column<StaffRow>[]>(
    () => [
      {
        key: "name",
        header: "Person",
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar user={r} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium">{r.displayName}{r.id === me.id ? <span className="font-normal text-muted-foreground"> (you)</span> : null}</p>
              <p className="truncate text-[12.5px] text-muted-foreground">{r.email}</p>
            </div>
          </div>
        ),
        sortValue: (r) => r.displayName.toLowerCase(),
        className: "min-w-[220px]",
      },
      {
        key: "role",
        header: "Role",
        cell: (r) =>
          r.id === me.id ? (
            <span className="text-[14px]">{ROLE_LABEL[r.role]}</span>
          ) : (
            <Select
              value={r.role}
              onValueChange={(v) => v !== r.role && setChange({ user: r, to: v as UserRole })}
              options={ROLE_OPTIONS}
              aria-label={`Role for ${r.displayName}`}
              className="h-9 w-[150px]"
              data-testid={`staff-role-${r.username}`}
            />
          ),
      },
      { key: "courses", header: "Courses", align: "right", cell: (r) => r.courseCount, sortValue: (r) => r.courseCount, hideBelow: "sm" },
      { key: "status", header: "Status", cell: (r) => (r.status === "ACTIVE" ? <span className="text-muted-foreground">Active</span> : <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>), hideBelow: "md" },
      { key: "since", header: "Joined", align: "right", cell: (r) => shortDate(r.createdAt), hideBelow: "lg" },
    ],
    [me.id],
  );

  return (
    <AdminPage
      title="Staff"
      description="Who can open the admin area, and what each role may do."
      actions={
        <Button onClick={() => setAdding(true)} data-testid="staff-add">
          <UserPlus /> Add staff
        </Button>
      }
      filters={<FilterBar tabs={TABS} tab={role} onTabChange={(v) => url.set({ role: v === "all" ? null : v })} tabsLabel="Role" search={q} onSearchChange={(v) => url.set({ q: v })} searchPlaceholder="Search staff" testId="staff-filter" />}
      testId="admin-staff"
    >
      <DataTable caption="Staff" columns={columns} rowKey={(r) => r.id} rowTestId={(r) => `staff-row-${r.username}`} empty={{ icon: <UserCog />, title: "No staff match" }} testId="staff-table" {...pagedTable(list)} />
      <dl className="mt-8 grid gap-x-8 gap-y-3 text-[13.5px] sm:grid-cols-2">
        {STAFF_ROLES.map((r) => (
          <div key={r}>
            <dt className="font-medium">{ROLE_LABEL[r]}</dt>
            <dd className="text-muted-foreground">{ROLE_HELP[r]}</dd>
          </div>
        ))}
      </dl>
      <RoleChangeDialog change={change} onClose={() => setChange(null)} onDone={() => void qc.invalidateQueries({ queryKey: qk.admin.area("staff") })} />
      <AddStaffDialog open={adding} onClose={() => setAdding(false)} onPick={(u, to) => (setAdding(false), setChange({ user: u, to }))} />
    </AdminPage>
  );
}

/** Copy for the role change confirmation; a stable function so it can be tested. */
export function roleChangeCopy(c: Change): { title: string; description: string; destructive: boolean } {
  const from = ROLE_LABEL[c.user.role];
  const to = ROLE_LABEL[c.to];
  if (c.to === "LEARNER") return { title: `Remove ${c.user.displayName} from staff?`, description: `They lose the admin area at once (${from} to Learner). Their courses keep their teams.`, destructive: true };
  return { title: `Make ${c.user.displayName} ${/^[AEIOU]/.test(to) ? "an" : "a"} ${to}?`, description: `${from} to ${to}. ${ROLE_HELP[c.to]}`, destructive: c.user.role === "ADMIN" };
}

function RoleChangeDialog({ change, onClose, onDone }: { change: Change | null; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (c: Change) => api().admin.changeRole(c.user.id, c.to),
    meta: { silent: true },
    onSuccess: (_r, c) => {
      onDone();
      toast.success({ title: `${c.user.displayName} is now ${ROLE_LABEL[c.to].toLowerCase()}` });
      onClose();
    },
    onError: (e) => setError(isApiError(e) && e.code === "LAST_ADMIN" ? "This is the only active administrator. Make someone else an admin first, then change this role." : errorMessage(e)),
  });
  const copy = change ? roleChangeCopy(change) : null;
  return (
    <Dialog open={!!change} onOpenChange={(o) => !o && !m.isPending && (setError(null), onClose())}>
      <DialogContent size="sm" data-testid="role-change-dialog">
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>{copy?.description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <DialogBody>
            <p role="alert" className="text-[13.5px] font-medium text-danger" data-testid="role-change-error">{error}</p>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => (setError(null), onClose())} disabled={m.isPending}>
            Cancel
          </Button>
          <Button variant={copy?.destructive ? "danger" : "primary"} loading={m.isPending} onClick={() => change && (setError(null), m.mutate(change))} data-testid="role-change-confirm">
            Change role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddStaffDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (u: AdminUserRow, to: UserRole) => void }) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<AdminUserRow | null>(null);
  const [role, setRole] = useState<UserRole>("INSTRUCTOR");
  const people = useQuery({ queryKey: qk.admin.list("staff-picker", { q: search }), queryFn: () => api().admin.learners({ q: search, limit: 10 }), enabled: open && search.trim().length >= 2 });
  const close = () => {
    setSearch("");
    setPicked(null);
    setRole("INSTRUCTOR");
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent size="md" data-testid="add-staff-dialog">
        <DialogHeader>
          <DialogTitle>Add a staff member</DialogTitle>
          <DialogDescription>Find someone with an account, then choose their role.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name or email" className="sm:w-full" testId="add-staff-search" />
          <ul role="listbox" aria-label="People" className="max-h-56 divide-y divide-border overflow-y-auto">
            {search.trim().length < 2 ? (
              <li className="py-3 text-[13.5px] text-muted-foreground">Type at least two characters.</li>
            ) : people.isPending ? (
              [0, 1].map((i) => <li key={i} className="py-2"><Skeleton className="h-8" /></li>)
            ) : people.data?.items.length ? (
              people.data.items.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={picked?.id === u.id}
                    onClick={() => setPicked(u)}
                    className={cn("flex w-full items-center gap-3 px-2 py-2 text-left transition-colors", picked?.id === u.id ? "bg-primary/10" : "hover:bg-muted")}
                    data-testid={`add-staff-${u.username}`}
                  >
                    <UserAvatar user={u} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{u.displayName}</span>
                      <span className="block truncate text-[12.5px] text-muted-foreground">{u.email} · {ROLE_LABEL[u.role]}</span>
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li className="py-3 text-[13.5px] text-muted-foreground">Nobody matches.</li>
            )}
          </ul>
          <div className="space-y-1.5">
            <p className="text-sm font-medium" id="add-staff-role">Role</p>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)} options={STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} aria-label="Role" data-testid="add-staff-role" />
            <p className="text-xs text-subtle-foreground">{ROLE_HELP[role]}</p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!picked || picked.role === role} onClick={() => picked && onPick(picked, role)} data-testid="add-staff-next">
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
