"use client";

import { useState } from "react";
import { ChevronRight, ScrollText, X } from "lucide-react";
import { EmptyState, Skeleton, cn } from "@open-lms/ui";
import type { AuditEntry } from "@open-lms/types";
import { api } from "@/lib/api";
import { humanizeAction, prettyJson } from "@/lib/admin-ops";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { fullTimestamp, relativeTime } from "@/lib/time";
import { ErrorState, LoadMore } from "@/components/common/states";
import { UserAvatar } from "@/components/common/user-bits";
import { AdminPage, AreaGate, FilterBar, SearchInput, useUrlState } from "../shell";

const GROUPS = [
  { value: "all", label: "Everything", prefix: "" },
  { value: "user", label: "Accounts", prefix: "user." },
  { value: "enrollment", label: "Enrollments", prefix: "enrollment." },
  { value: "course", label: "Courses", prefix: "course." },
  { value: "order", label: "Orders", prefix: "order." },
  { value: "refund", label: "Refunds", prefix: "refund." },
  { value: "certificate", label: "Certificates", prefix: "certificate." },
  { value: "settings", label: "Settings", prefix: "settings." },
] as const;
type Group = (typeof GROUPS)[number]["value"];

export function AdminAudit() {
  return (
    <AreaGate area="audit">
      <AuditInner />
    </AreaGate>
  );
}

function AuditInner() {
  const url = useUrlState();
  const groupParam = url.get("group");
  const group: Group = GROUPS.some((g) => g.value === groupParam) ? (groupParam as Group) : "all";
  const custom = url.get("action");
  const action = custom || GROUPS.find((g) => g.value === group)!.prefix;
  const actorId = url.get("actor");
  const actorName = url.get("actorName");
  const entityType = url.get("entityType");
  const entityId = url.get("entityId");
  const f = { action, actorId, entityType, entityId };
  const list = usePagedList<AuditEntry>({
    queryKey: qk.admin.list("audit", f),
    fetchPage: (cursor) => api().admin.audit({ action: action || undefined, actorId: actorId || undefined, entityType: entityType || undefined, entityId: entityId || undefined, cursor, limit: 50 }),
  });
  const active = [
    actorId ? { key: "actor", label: `By ${actorName || "one person"}`, clear: { actor: null, actorName: null } } : null,
    entityType ? { key: "entityType", label: `Type ${entityType}`, clear: { entityType: null } } : null,
    entityId ? { key: "entityId", label: `Item ${entityId}`, clear: { entityId: null } } : null,
    custom ? { key: "action", label: `Action starts with ${custom}`, clear: { action: null } } : null,
  ].filter(Boolean) as unknown as { key: string; label: string; clear: Record<string, null> }[];

  return (
    <AdminPage
      title="Audit log"
      description="Every change made in the admin area, newest first: who did it, to what, and the details recorded."
      filters={
        <div>
          <FilterBar
            tabs={GROUPS.map((g) => ({ value: g.value, label: g.label }))}
            tab={group}
            onTabChange={(v) => url.set({ group: v === "all" ? null : v, action: null })}
            tabsLabel="Action"
            search={custom}
            onSearchChange={(v) => url.set({ action: v.trim() })}
            searchPlaceholder="Action, for example user.ban"
            testId="audit-filter"
          >
            <SearchInput value={entityType} onChange={(v) => url.set({ entityType: v.trim() })} placeholder="Entity type" className="sm:w-36" testId="audit-entity-type" />
            <SearchInput value={entityId} onChange={(v) => url.set({ entityId: v.trim() })} placeholder="Entity id" className="sm:w-40" testId="audit-entity-id" />
          </FilterBar>
          {active.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              {active.map((a) => (
                <button key={a.key} type="button" onClick={() => url.set(a.clear)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" aria-label={`Clear filter: ${a.label}`}>
                  {a.label} <X className="size-3.5" aria-hidden />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      }
      testId="admin-audit"
    >
      {list.isError && !list.items.length ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <ul className="divide-y divide-border border-b border-border" aria-busy>
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 py-3.5">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="ml-auto h-4 w-16" />
            </li>
          ))}
        </ul>
      ) : !list.items.length ? (
        <EmptyState compact icon={<ScrollText />} title={active.length || action ? "Nothing matches these filters" : "Nothing recorded yet"} />
      ) : (
        <>
          <ul className="divide-y divide-border border-b border-border" data-testid="audit-list">
            {list.items.map((e) => (
              <AuditRow key={e.id} entry={e} onActor={(a) => url.set({ actor: a.id, actorName: a.displayName })} onEntity={(t, id) => url.set({ entityType: t, entityId: id })} />
            ))}
          </ul>
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} endLabel="That is the start of the log." />
        </>
      )}
    </AdminPage>
  );
}

function AuditRow({ entry: e, onActor, onEntity }: { entry: AuditEntry; onActor: (a: NonNullable<AuditEntry["actor"]>) => void; onEntity: (type: string, id: string) => void }) {
  const [open, setOpen] = useState(false);
  const hasData = Object.keys(e.data ?? {}).length > 0;
  const panel = `audit-${e.id}`;
  return (
    <li data-testid={`audit-row-${e.id}`}>
      <div className="flex items-start gap-3 py-3">
        {e.actor ? <UserAvatar user={e.actor} size="sm" /> : <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground" aria-hidden>SYS</span>}
        <div className="min-w-0 flex-1">
          <p className="text-[14px]">
            {e.actor ? (
              <button type="button" className="font-medium text-foreground hover:underline" onClick={() => onActor(e.actor!)} title="Show only this person's changes">
                {e.actor.displayName}
              </button>
            ) : (
              <span className="font-medium">The system</span>
            )}
            <span className="text-muted-foreground"> · {humanizeAction(e.action)}</span>
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            <span className="font-mono">{e.action}</span>
            {" · "}
            {e.entityId ? (
              <button type="button" className="font-mono hover:text-foreground hover:underline" onClick={() => onEntity(e.entityType, e.entityId!)} title="Show every change to this item">
                {e.entityType} {e.entityId}
              </button>
            ) : (
              <span className="font-mono">{e.entityType}</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <time dateTime={e.createdAt} title={fullTimestamp(e.createdAt)} className="text-[12.5px] tabular-nums text-muted-foreground">
            {relativeTime(e.createdAt)}
          </time>
          {hasData ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panel}
              onClick={() => setOpen((o) => !o)}
              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={open ? "Hide details" : "Show details"}
              data-testid="audit-expand"
            >
              <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
            </button>
          ) : (
            <span className="inline-block size-8" aria-hidden />
          )}
        </div>
      </div>
      {open && hasData ? (
        <pre id={panel} className="mb-3 ml-11 max-h-80 overflow-auto rounded-md bg-ground-2 p-3 font-mono text-[12.5px] leading-relaxed text-foreground" data-testid="audit-data">
          {prettyJson(e.data)}
        </pre>
      ) : null}
    </li>
  );
}
