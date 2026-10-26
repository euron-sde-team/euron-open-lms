"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Skeleton, Textarea, cn, toast } from "@open-lms/ui";
import type { AdminCourseRow, AdminDownloadRow, AdminEnrollment, AdminLearnerDetail, AdminUserRow, Page, UserStatus } from "@open-lms/types";
import { api } from "@/lib/api";
import { accountActions, endOfDayIso, protectionOf, ROLE_LABEL, shortDate, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, SUBSCRIPTION_LABEL, toDateInput } from "@/lib/admin-ops";
import { errorMessage } from "@/lib/errors";
import { usePagedList } from "@/lib/hooks/queries";
import { useMe } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { relativeTime } from "@/lib/time";
import { UserAvatar } from "@/components/common/user-bits";
import { AdminPage, DataTable, DetailSection, DetailSheet, FactList, FilterBar, ReasonDialog, SearchInput, pagedTable, useAdminSession, useUrlState, type Column } from "../shell";

type StatusTab = "all" | UserStatus;
const TABS: { value: StatusTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "PENDING_VERIFICATION", label: "Not verified" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "BANNED", label: "Banned" },
  { value: "DEACTIVATED", label: "Deactivated" },
];

const listKey = (f: Record<string, unknown>) => qk.admin.list("learners", f);

export function AdminLearners() {
  const url = useUrlState();
  const q = url.get("q");
  const status = (TABS.some((t) => t.value === url.get("status")) ? url.get("status") : "all") as StatusTab;
  const open = url.get("open") || null;
  const list = usePagedList<AdminUserRow>({
    queryKey: listKey({ q, status }),
    fetchPage: (cursor) => api().admin.learners({ q: q || undefined, status: status === "all" ? undefined : status, cursor, limit: 30 }),
  });

  const columns = useMemo<Column<AdminUserRow>[]>(
    () => [
      {
        key: "name",
        header: "Learner",
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar user={r} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{r.displayName}</p>
              <p className="truncate text-[12.5px] text-muted-foreground">{r.email}</p>
            </div>
          </div>
        ),
        className: "min-w-[220px]",
      },
      { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} />, hideBelow: "sm" },
      { key: "enrollments", header: "Courses", align: "right", cell: (r) => r.enrollmentCount, hideBelow: "md" },
      { key: "spent", header: "Spent", align: "right", cell: (r) => (r.totalSpent.length ? r.totalSpent.map((m) => formatMoney(m)).join(" · ") : <span className="text-subtle-foreground">None</span>), hideBelow: "lg" },
      { key: "seen", header: "Last seen", align: "right", cell: (r) => (r.lastSeenAt ? relativeTime(r.lastSeenAt) : <span className="text-subtle-foreground">Never</span>), hideBelow: "md" },
      { key: "joined", header: "Joined", align: "right", cell: (r) => shortDate(r.createdAt), hideBelow: "lg" },
    ],
    [],
  );

  return (
    <AdminPage
      title="Learners"
      description="Find a learner to see their courses and orders, grant access or restrict the account."
      filters={
        <FilterBar
          tabs={TABS}
          tab={status}
          onTabChange={(v) => url.set({ status: v === "all" ? null : v })}
          tabsLabel="Account status"
          search={q}
          onSearchChange={(v) => url.set({ q: v })}
          searchPlaceholder="Search by name, username or email"
          testId="learners-filter"
        />
      }
      testId="admin-learners"
    >
      <DataTable
        caption="Learners"
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={(r) => url.set({ open: r.id })}
        selectedKey={open}
        rowTestId={(r) => `learner-row-${r.username}`}
        empty={{ icon: <Users />, title: q || status !== "all" ? "No learners match" : "No learners yet", description: q ? "Try a different name or email." : undefined }}
        testId="learners-table"
        {...pagedTable(list)}
      />
      <LearnerSheet id={open} onClose={() => url.set({ open: null })} />
    </AdminPage>
  );
}

function StatusBadge({ status }: { status: UserStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

type Dialogs = { kind: "suspend" | "ban" | "erase" | "grant" } | { kind: "revoke" | "extend"; enrollment: AdminEnrollment } | null;

function LearnerSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useMe();
  const session = useAdminSession();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const detailKey = qk.admin.detail("learners", id ?? "");
  const q = useQuery({ queryKey: detailKey, queryFn: () => api().admin.learner(id!), enabled: !!id });
  const d = q.data;

  /** Apply a changed row to the open detail and refresh the lists. */
  const applyRow = (row: Partial<AdminUserRow>) => {
    qc.setQueryData<AdminLearnerDetail>(detailKey, (old) => (old ? { ...old, ...row } : old));
    void qc.invalidateQueries({ queryKey: qk.admin.area("learners") });
  };
  const applyEnrollment = (e: AdminEnrollment) => {
    qc.setQueryData<AdminLearnerDetail>(detailKey, (old) => {
      if (!old) return old;
      const exists = old.enrollments.some((x) => x.id === e.id);
      return { ...old, enrollments: exists ? old.enrollments.map((x) => (x.id === e.id ? e : x)) : [e, ...old.enrollments] };
    });
    void qc.invalidateQueries({ queryKey: qk.admin.list("learners") });
  };

  const unsuspend = useMutation({ mutationFn: () => api().admin.unsuspend(id!), onSuccess: (r) => (applyRow(r), toast.success({ title: "Suspension lifted" })) });
  const unban = useMutation({ mutationFn: () => api().admin.unban(id!), onSuccess: (r) => (applyRow(r), toast.success({ title: "Ban lifted" })) });

  const protection = d ? protectionOf(me, d) : null;
  const acts = d ? accountActions(d.status) : null;

  return (
    <>
      <DetailSheet
        open={!!id}
        onOpenChange={(o) => !o && onClose()}
        title={d?.displayName ?? ""}
        description={d ? `${d.email} · @${d.username}${d.role !== "LEARNER" ? ` · ${ROLE_LABEL[d.role]}` : ""}` : undefined}
        leading={d ? <UserAvatar user={d} size="lg" /> : <Skeleton className="size-12 rounded-full" />}
        loading={q.isPending && !!id}
        error={q.error}
        onRetry={() => void q.refetch()}
        testId="learner-sheet"
        actions={
          d && acts ? (
            protection ? (
              <p className="text-[13px] text-muted-foreground">{protection === "SELF_ACTION" ? "This is your own account." : "Staff at or above your role can only be changed by an administrator."}</p>
            ) : (
              <>
                {acts.suspend ? (
                  <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "suspend" })} data-testid="learner-suspend">
                    Suspend
                  </Button>
                ) : null}
                {acts.unsuspend ? (
                  <Button size="sm" variant="outline" loading={unsuspend.isPending} onClick={() => unsuspend.mutate()} data-testid="learner-unsuspend">
                    Lift suspension
                  </Button>
                ) : null}
                {acts.ban ? (
                  <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "ban" })} data-testid="learner-ban">
                    Ban
                  </Button>
                ) : null}
                {acts.unban ? (
                  <Button size="sm" variant="outline" loading={unban.isPending} onClick={() => unban.mutate()} data-testid="learner-unban">
                    Lift ban
                  </Button>
                ) : null}
                {session.isAdmin && d.status !== "DEACTIVATED" ? (
                  <Button size="sm" variant="danger-ghost" onClick={() => setDialog({ kind: "erase" })} data-testid="learner-erase">
                    Erase account
                  </Button>
                ) : null}
              </>
            )
          ) : null
        }
      >
        {d ? (
          <>
            <DetailSection title="Profile">
              <FactList
                items={[
                  { label: "Status", value: <span className="inline-flex items-center gap-2"><StatusBadge status={d.status} />{d.suspendedUntil ? <span className="text-muted-foreground">until {shortDate(d.suspendedUntil)}</span> : null}</span> },
                  { label: "Email", value: `${d.email}${d.emailVerified ? "" : " (not verified)"}` },
                  { label: "Two-step sign-in", value: d.totpEnabled ? "On" : "Off" },
                  { label: "Joined", value: shortDate(d.createdAt) },
                  { label: "Last seen", value: d.lastSeenAt ? relativeTime(d.lastSeenAt) : "Never" },
                  { label: "Spent", value: d.totalSpent.length ? d.totalSpent.map((m) => formatMoney(m)).join(" · ") : "Nothing yet" },
                  ...(d.bio ? [{ label: "Bio", value: d.bio }] : []),
                ]}
              />
            </DetailSection>

            <DetailSection
              title={`Enrollments (${d.enrollments.length})`}
              testId="learner-enrollments"
              action={
                <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "grant" })} data-testid="learner-grant">
                  <Plus /> Grant access
                </Button>
              }
            >
              {d.enrollments.length ? (
                <ul className="divide-y divide-border">
                  {d.enrollments.map((e) => (
                    <li key={e.id} className="py-3 first:pt-0" data-testid={`enrollment-${e.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{e.course.title}</p>
                          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                            {[
                              SOURCE_LABEL[e.source],
                              `${Math.round(e.progressPercent)}% done`,
                              e.completedAt ? `completed ${shortDate(e.completedAt)}` : null,
                              e.validUntil ? `until ${shortDate(e.validUntil)}` : e.status === "ACTIVE" ? "lifetime" : null,
                              e.orderNumber ? `order ${e.orderNumber}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {e.grantNote ? <p className="mt-1 text-[12.5px] text-muted-foreground">Note: {e.grantNote}{e.grantedBy ? `, by ${e.grantedBy.displayName}` : ""}</p> : null}
                          {e.status === "REVOKED" ? <p className="mt-1 text-[12.5px] text-danger">Revoked {shortDate(e.revokedAt)}{e.revokedReason ? `: ${e.revokedReason}` : ""}</p> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {e.status === "REVOKED" ? <Badge tone="danger">Revoked</Badge> : !e.grantsAccess ? <Badge tone="warning">No access</Badge> : null}
                          {e.status === "ACTIVE" && e.source !== "SUBSCRIPTION" ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "extend", enrollment: e })} data-testid="enrollment-extend">
                                Change end date
                              </Button>
                              <Button size="sm" variant="danger-ghost" onClick={() => setDialog({ kind: "revoke", enrollment: e })} data-testid="enrollment-revoke">
                                Revoke
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13.5px] text-muted-foreground">Not enrolled in any course.</p>
              )}
            </DetailSection>

            <DetailSection title="Subscription">
              {d.subscription ? (
                <p className="text-[13.5px]">
                  <span className="font-medium">{d.subscription.plan}</span>
                  <span className="text-muted-foreground"> · {SUBSCRIPTION_LABEL[d.subscription.status]}{d.subscription.currentPeriodEnd ? ` · renews or ends ${shortDate(d.subscription.currentPeriodEnd)}` : ""}</span>
                </p>
              ) : (
                <p className="text-[13.5px] text-muted-foreground">No subscription.</p>
              )}
            </DetailSection>

            <DetailSection title="Recent orders">
              {d.recentOrders.length ? (
                <ul className="divide-y divide-border">
                  {d.recentOrders.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 text-[13.5px]">
                      <div className="min-w-0">
                        <Link href={`/admin/orders/${o.id}`} className="font-medium text-foreground hover:text-link hover:underline">
                          {o.number}
                        </Link>
                        <p className="truncate text-[12.5px] text-muted-foreground">{o.title} · {shortDate(o.createdAt)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums">{formatMoney(o.total)}</span>
                        <Badge tone={o.status === "PAID" ? "success" : o.status === "FAILED" ? "danger" : "neutral"}>{o.status.charAt(0) + o.status.slice(1).toLowerCase().replace(/_/g, " ")}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13.5px] text-muted-foreground">No orders.</p>
              )}
            </DetailSection>

            <DetailSection title="Certificates">
              {d.certificates.length ? (
                <ul className="divide-y divide-border">
                  {d.certificates.map((c) => (
                    <li key={c.serial} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 text-[13.5px]">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.courseTitle}</p>
                        <p className="text-[12.5px] text-muted-foreground">
                          <Link href={`/verify/${encodeURIComponent(c.serial)}`} className="font-mono hover:text-link hover:underline">{c.serial}</Link> · {shortDate(c.issuedAt)}
                        </p>
                      </div>
                      {c.revoked ? <Badge tone="danger">Revoked</Badge> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13.5px] text-muted-foreground">No certificates yet.</p>
              )}
            </DetailSection>

            <DownloadsSection learnerId={d.id} />
          </>
        ) : null}
      </DetailSheet>

      {d ? (
        <>
          <ReasonDialog
            open={dialog?.kind === "suspend"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Suspend ${d.displayName}?`}
            description="They can keep watching their courses but cannot post reviews or questions until the suspension ends."
            confirmLabel="Suspend"
            days={7}
            maxDays={365}
            onConfirm={async ({ reason, days }) => {
              applyRow(await api().admin.suspend(d.id, { days, reason }));
              toast.success({ title: `Suspended for ${days} ${days === 1 ? "day" : "days"}` });
            }}
            testId="suspend-dialog"
          />
          <ReasonDialog
            open={dialog?.kind === "ban"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Ban ${d.displayName}?`}
            description="They are signed out everywhere and cannot sign in until the ban is lifted."
            confirmLabel="Ban account"
            destructive
            onConfirm={async ({ reason }) => {
              applyRow(await api().admin.ban(d.id, reason));
              toast.success({ title: "Account banned" });
            }}
            testId="ban-dialog"
          />
          <ReasonDialog
            open={dialog?.kind === "erase"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Erase ${d.displayName}'s account?`}
            description="Their name, email and learning history are removed for good. Orders and invoices are kept for the books. This cannot be undone."
            confirmLabel="Erase for good"
            destructive
            typeToConfirm={d.username}
            onConfirm={async ({ reason }) => {
              try {
                await api().admin.erase(d.id, reason);
              } catch (e) {
                if (isApiError(e) && e.code === "SUBSCRIPTION_ACTIVE") throw new Error("Cancel this learner's subscription before erasing the account.");
                throw e;
              }
              toast.success({ title: "Account erased" });
              void qc.invalidateQueries({ queryKey: qk.admin.area("learners") });
              onClose();
            }}
            testId="erase-dialog"
          />
          <ReasonDialog
            open={dialog?.kind === "revoke"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={dialog?.kind === "revoke" ? `Revoke access to ${dialog.enrollment.course.title}?` : "Revoke access"}
            description="Access ends now. Their progress is kept, and they are told by email."
            confirmLabel="Revoke access"
            destructive
            onConfirm={async ({ reason }) => {
              if (dialog?.kind !== "revoke") return;
              applyEnrollment(await api().admin.revokeEnrollment(dialog.enrollment.id, reason));
              toast.success({ title: "Access revoked" });
            }}
            testId="revoke-dialog"
          />
          <ExtendDialog enrollment={dialog?.kind === "extend" ? dialog.enrollment : null} onClose={() => setDialog(null)} onDone={applyEnrollment} />
          <GrantDialog open={dialog?.kind === "grant"} learner={d} onClose={() => setDialog(null)} onDone={applyEnrollment} />
        </>
      ) : null}
    </>
  );
}

/** Videos saved in the mobile app; revoking one makes the app delete it at its next check. */
function DownloadsSection({ learnerId }: { learnerId: string }) {
  const qc = useQueryClient();
  const key = qk.admin.detail("learner-downloads", learnerId);
  const q = useQuery({ queryKey: key, queryFn: () => api().admin.learnerDownloads(learnerId, { limit: 50 }) });
  const revoke = useMutation({
    mutationFn: (id: string) => api().admin.revokeDownload(id),
    onSuccess: (row) => {
      qc.setQueryData<Page<AdminDownloadRow>>(key, (old) => (old ? { ...old, items: old.items.map((x) => (x.id === row.id ? row : x)) } : old));
      toast.success({ title: "Download revoked" });
    },
    onError: (e) => toast.error({ title: errorMessage(e) }),
  });
  const rows = q.data?.items ?? [];
  return (
    <DetailSection title="Offline downloads">
      {q.isPending ? (
        <Skeleton className="h-10" />
      ) : rows.length ? (
        <ul className="divide-y divide-border" data-testid="learner-downloads">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 text-[13.5px]">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.item.title}</p>
                <p className="truncate text-[12.5px] text-muted-foreground">
                  {r.course.title} · device {r.deviceId.slice(0, 8)} · {r.revokedAt ? `revoked ${shortDate(r.revokedAt)}` : `plays offline until ${shortDate(r.expiresAt)}`}
                </p>
              </div>
              {r.active ? (
                <Button size="sm" variant="outline" loading={revoke.isPending && revoke.variables === r.id} onClick={() => revoke.mutate(r.id)} data-testid="download-revoke">
                  Revoke
                </Button>
              ) : (
                <Badge tone={r.revokedAt ? "danger" : "neutral"}>{r.revokedAt ? "Revoked" : "Expired"}</Badge>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13.5px] text-muted-foreground">No videos saved in the mobile app.</p>
      )}
    </DetailSection>
  );
}

function ExtendDialog({ enrollment, onClose, onDone }: { enrollment: AdminEnrollment | null; onClose: () => void; onDone: (e: AdminEnrollment) => void }) {
  const [day, setDay] = useState("");
  const [lifetime, setLifetime] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (enrollment && openedFor !== enrollment.id) {
    setOpenedFor(enrollment.id);
    setDay(toDateInput(enrollment.validUntil));
    setLifetime(!enrollment.validUntil);
    setError(null);
  }
  const save = async () => {
    if (!enrollment) return;
    const iso = lifetime ? null : endOfDayIso(day);
    if (!lifetime && (!iso || new Date(iso).getTime() <= Date.now())) return setError("Pick a date in the future.");
    setBusy(true);
    try {
      onDone(await api().admin.setEnrollmentValidUntil(enrollment.id, iso));
      toast.success({ title: iso ? `Access until ${shortDate(iso)}` : "Lifetime access" });
      setOpenedFor(null);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!enrollment} onOpenChange={(o) => !o && !busy && (setOpenedFor(null), onClose())}>
      <DialogContent size="sm" data-testid="extend-dialog">
        <DialogHeader>
          <DialogTitle>Change the end date</DialogTitle>
          <DialogDescription>{enrollment?.course.title}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={lifetime} onChange={(e) => setLifetime(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" data-testid="extend-lifetime" />
            Lifetime access
          </label>
          {!lifetime ? (
            <Field label="Access ends on" htmlFor="extend-day" error={error ?? undefined}>
              <Input id="extend-day" type="date" value={day} min={toDateInput(new Date(Date.now() + 86_400_000).toISOString())} onChange={(e) => setDay(e.target.value)} className="w-48" data-testid="extend-date" />
            </Field>
          ) : error ? (
            <p role="alert" className="text-[13px] font-medium text-danger">{error}</p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => (setOpenedFor(null), onClose())} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} data-testid="extend-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantDialog({ open, learner, onClose, onDone }: { open: boolean; learner: AdminLearnerDetail; onClose: () => void; onDone: (e: AdminEnrollment) => void }) {
  const [search, setSearch] = useState("");
  const [course, setCourse] = useState<AdminCourseRow | null>(null);
  const [day, setDay] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const courses = useQuery({
    queryKey: qk.admin.list("course-picker", { q: search }),
    queryFn: () => api().authoring.courses.list({ q: search || undefined, limit: 20 }),
    enabled: open,
    placeholderData: (p) => p,
  });
  const active = new Set(learner.enrollments.filter((e) => e.status === "ACTIVE" && e.grantsAccess).map((e) => e.course.id));
  const reset = () => {
    setSearch("");
    setCourse(null);
    setDay("");
    setNote("");
    setError(null);
  };
  const grant = async () => {
    if (!course) return setError("Pick a course.");
    const validUntil = endOfDayIso(day);
    if (validUntil && new Date(validUntil).getTime() <= Date.now()) return setError("Pick an end date in the future, or leave it empty for lifetime access.");
    setBusy(true);
    setError(null);
    try {
      onDone(await api().admin.grantEnrollment(learner.id, { courseId: course.id, validUntil, note: note.trim() || null }));
      toast.success({ title: `${learner.displayName} can now open ${course.title}` });
      reset();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && (reset(), onClose())}>
      <DialogContent size="md" data-testid="grant-dialog">
        <DialogHeader>
          <DialogTitle>Grant course access</DialogTitle>
          <DialogDescription>{learner.displayName} gets the course without paying. The grant is recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium" id="grant-course-label">Course</p>
            <SearchInput value={search} onChange={setSearch} placeholder="Search courses" className="sm:w-full" testId="grant-course-search" />
            <ul role="listbox" aria-labelledby="grant-course-label" className="max-h-56 divide-y divide-border overflow-y-auto">
              {courses.isPending ? (
                [0, 1, 2].map((i) => <li key={i} className="py-2"><Skeleton className="h-5 w-2/3" /></li>)
              ) : courses.data?.items.length ? (
                courses.data.items.map((c) => {
                  const has = active.has(c.id);
                  const selected = course?.id === c.id;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={has}
                        onClick={() => setCourse(c)}
                        data-testid={`grant-course-${c.slug}`}
                        className={cn("flex w-full items-center justify-between gap-3 px-2 py-2 text-left text-[14px] transition-colors disabled:opacity-60", selected ? "bg-primary/10" : "hover:bg-muted")}
                      >
                        <span className="min-w-0 truncate">{c.title}</span>
                        <span className="shrink-0 text-[12.5px] text-muted-foreground">{has ? "Already enrolled" : c.status.charAt(0) + c.status.slice(1).toLowerCase()}</span>
                      </button>
                    </li>
                  );
                })
              ) : (
                <li className="py-3 text-[13.5px] text-muted-foreground">No courses match.</li>
              )}
            </ul>
          </div>
          <Field label="Access ends on" htmlFor="grant-until" optional hint="Leave empty for lifetime access.">
            <Input id="grant-until" type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-48" data-testid="grant-until" />
          </Field>
          <Field label="Note" htmlFor="grant-note" optional hint="Why the access was given, for the team.">
            <Textarea id="grant-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} data-testid="grant-note" />
          </Field>
          {error ? <p role="alert" className="text-[13px] font-medium text-danger">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => (reset(), onClose())} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void grant()} loading={busy} disabled={!course} data-testid="grant-confirm">
            {course ? `Grant ${course.title.length > 28 ? "access" : course.title}` : "Grant access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
