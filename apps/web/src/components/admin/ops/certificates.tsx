"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Award } from "lucide-react";
import { Badge, Button, toast } from "@open-lms/ui";
import type { AdminCertificateRow } from "@open-lms/types";
import { api } from "@/lib/api";
import { shortDate } from "@/lib/admin-ops";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { UserAvatar } from "@/components/common/user-bits";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { AdminPage, DataTable, FilterBar, ReasonDialog, pagedTable, useUrlState, type Column } from "../shell";

export function AdminCertificates() {
  const url = useUrlState();
  const q = url.get("q");
  const qc = useQueryClient();
  const [revoking, setRevoking] = useState<AdminCertificateRow | null>(null);
  const [restoring, setRestoring] = useState<AdminCertificateRow | null>(null);
  const list = usePagedList<AdminCertificateRow>({
    queryKey: qk.admin.list("certificates", { q }),
    fetchPage: (cursor) => api().admin.certificates({ q: q || undefined, cursor, limit: 30 }),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.admin.area("certificates") });
  const restore = useMutation({ mutationFn: (id: string) => api().admin.restoreCertificate(id), onSuccess: () => (refresh(), toast.success({ title: "Certificate restored" })) });

  const columns = useMemo<Column<AdminCertificateRow>[]>(
    () => [
      {
        key: "learner",
        header: "Learner",
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar user={r.learner} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium">{r.learnerName}</p>
              <p className="truncate text-[12.5px] text-muted-foreground">{r.learner.email}</p>
            </div>
          </div>
        ),
        className: "min-w-[200px]",
      },
      { key: "course", header: "Course", cell: (r) => <span className="line-clamp-2">{r.courseTitle}</span>, hideBelow: "md" },
      {
        key: "serial",
        header: "Serial",
        cell: (r) => (
          <Link href={`/verify/${encodeURIComponent(r.serial)}`} target="_blank" className="inline-flex items-center gap-1 font-mono text-[13px] text-link hover:underline" data-testid={`cert-verify-${r.serial}`}>
            {r.serial} <ArrowUpRight className="size-3" aria-hidden />
            <span className="sr-only">(opens the public verify page)</span>
          </Link>
        ),
      },
      { key: "issued", header: "Issued", align: "right", cell: (r) => shortDate(r.issuedAt), sortValue: (r) => r.issuedAt, hideBelow: "sm" },
      {
        key: "state",
        header: <span className="sr-only">Status and actions</span>,
        align: "right",
        cell: (r) =>
          r.revokedAt ? (
            <div className="flex items-center justify-end gap-2">
              <Badge tone="danger" title={r.revokedReason ?? undefined}>Revoked</Badge>
              <Button size="sm" variant="ghost" onClick={() => setRestoring(r)} data-testid="cert-restore">
                Restore
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="danger-ghost" onClick={() => setRevoking(r)} data-testid="cert-revoke">
              Revoke
            </Button>
          ),
      },
    ],
    [],
  );

  return (
    <AdminPage
      title="Certificates"
      description="Every certificate issued. A revoked certificate shows as revoked on its public verify page."
      filters={<FilterBar search={q} onSearchChange={(v) => url.set({ q: v })} searchPlaceholder="Search by serial, learner or course" testId="certificates-filter" />}
      testId="admin-certificates"
    >
      <DataTable caption="Certificates" columns={columns} rowKey={(r) => r.id} rowTestId={(r) => `cert-row-${r.serial}`} empty={{ icon: <Award />, title: q ? "No certificates match" : "No certificates issued yet" }} testId="certificates-table" {...pagedTable(list)} />
      <ReasonDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking ? `Revoke certificate ${revoking.serial}?` : "Revoke certificate"}
        description={revoking ? `Issued to ${revoking.learnerName} for ${revoking.courseTitle}. Anyone checking it will see it was revoked, with no reason shown.` : undefined}
        confirmLabel="Revoke certificate"
        destructive
        onConfirm={async ({ reason }) => {
          await api().admin.revokeCertificate(revoking!.id, reason);
          refresh();
          toast.success({ title: "Certificate revoked" });
        }}
        testId="cert-revoke-dialog"
      />
      <ConfirmDialog
        open={!!restoring}
        onOpenChange={(o) => !o && setRestoring(null)}
        title={restoring ? `Restore certificate ${restoring.serial}?` : "Restore certificate"}
        description="It verifies as valid again."
        confirmLabel="Restore"
        onConfirm={() => restore.mutateAsync(restoring!.id)}
        testId="cert-restore-dialog"
      />
    </AdminPage>
  );
}
