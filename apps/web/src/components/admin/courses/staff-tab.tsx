"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, UserPlus, X } from "lucide-react";
import { Button, IconButton, Select, Switch, toast } from "@open-lms/ui";
import type { AdminCourse, CourseStaffRole, UserSummary } from "@open-lms/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { UserAvatar } from "@/components/common/user-bits";
import { SearchInput } from "@/components/admin/shell/filter-bar";
import { useAdminSession } from "@/components/admin/shell/session";
import { FormSection, ReadOnlyNote, useSetCourse, type CourseRights } from "./course-bits";

type StaffEntry = UserSummary & { courseRole: CourseStaffRole; listed: boolean };

const ROLE_OPTIONS: { value: CourseStaffRole; label: string }[] = [
  { value: "OWNER", label: "Owner" },
  { value: "EDITOR", label: "Editor" },
  { value: "GRADER", label: "Grader" },
];

/** Why a staff list can not be saved, or null. */
export function staffProblem(list: readonly StaffEntry[]): string | null {
  if (!list.length) return "A course needs at least one person on its team.";
  if (!list.some((s) => s.courseRole === "OWNER")) return "Keep at least one owner.";
  if (list.length > 20) return "A course team has at most 20 people.";
  return null;
}

export function StaffTab({ course, rights }: { course: AdminCourse; rights: CourseRights }) {
  const viewer = useAdminSession();
  const setCourse = useSetCourse(course.id);
  const [list, setList] = useState<StaffEntry[]>(course.staff);
  const [q, setQ] = useState("");
  const dirty = JSON.stringify(list) !== JSON.stringify(course.staff);
  useEffect(() => {
    if (!dirty) setList(course.staff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.staff]);
  const canSearch = rights.canManage && viewer.can("staff");
  const search = useQuery({
    queryKey: qk.admin.list("staff-search", { q }),
    queryFn: () => api().admin.staff({ q, limit: 8 }),
    enabled: canSearch && q.trim().length >= 2,
    staleTime: 30_000,
  });
  const onTeam = useMemo(() => new Set(list.map((s) => s.id)), [list]);
  const save = useMutation({
    mutationFn: () => api().authoring.courses.setStaff(course.id, list.map((s) => ({ userId: s.id, role: s.courseRole, listed: s.listed }))),
    onSuccess: (c) => {
      setCourse(c);
      setList(c.staff);
      toast.success({ title: "Team saved." });
    },
  });
  const problem = staffProblem(list);
  const disabled = !rights.canManage;
  const patch = (id: string, p: Partial<StaffEntry>) => setList((l) => l.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) =>
    setList((l) => {
      const next = l.slice();
      const [x] = next.splice(i, 1);
      next.splice(i + d, 0, x!);
      return next;
    });

  return (
    <div className="max-w-[760px]" data-testid="course-staff">
      {disabled ? <ReadOnlyNote>{rights.manageReason}</ReadOnlyNote> : null}
      <FormSection title="Course team" description="Owners manage settings, prices and the team. Editors change content. Graders review assignments. Listed people show as instructors on the course page, in this order.">
        <ul className="divide-y divide-border border-y border-border">
          {list.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`staff-${s.username}`}>
              <UserAvatar user={s} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.displayName}</p>
                <p className="truncate text-[12.5px] text-muted-foreground">@{s.username}</p>
              </div>
              <div className="w-32">
                <Select aria-label={`Role for ${s.displayName}`} value={s.courseRole} onValueChange={(v) => patch(s.id, { courseRole: v as CourseStaffRole })} options={ROLE_OPTIONS} disabled={disabled} data-testid="staff-role" />
              </div>
              <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Switch checked={s.listed} onCheckedChange={(v) => patch(s.id, { listed: v })} disabled={disabled} aria-label={`Show ${s.displayName} on the course page`} data-testid="staff-listed" />
                Listed
              </label>
              {!disabled ? (
                <div className="flex">
                  <IconButton size="sm" label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </IconButton>
                  <IconButton size="sm" label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </IconButton>
                  <IconButton size="sm" label={`Remove ${s.displayName} from the team`} onClick={() => setList((l) => l.filter((x) => x.id !== s.id))} data-testid="staff-remove">
                    <X />
                  </IconButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {problem && dirty ? (
          <p role="alert" className="mt-2 text-[13px] font-medium text-danger">
            {problem}
          </p>
        ) : null}
      </FormSection>

      {!disabled ? (
        <FormSection title="Add people" description={canSearch ? "Instructors and staff accounts can join a course team." : "Only an administrator can look up accounts. Ask one to add people to this course."}>
          {canSearch ? (
            <>
              <SearchInput value={q} onChange={setQ} placeholder="Search staff by name or email" className="sm:w-80" testId="staff-search" />
              {q.trim().length >= 2 ? (
                <ul className="mt-2 divide-y divide-border" aria-live="polite">
                  {search.isPending ? <li className="py-2 text-sm text-muted-foreground">Searching</li> : null}
                  {search.data?.items.length === 0 ? <li className="py-2 text-sm text-muted-foreground">No staff accounts match.</li> : null}
                  {search.data?.items.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 py-2">
                      <UserAvatar user={u} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{u.displayName}</p>
                        <p className="truncate text-[12.5px] text-muted-foreground">{u.email}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={onTeam.has(u.id)}
                        onClick={() => setList((l) => [...l, { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, headline: u.headline, role: u.role, courseRole: "EDITOR", listed: false }])}
                        data-testid={`staff-add-${u.username}`}
                      >
                        <UserPlus /> {onTeam.has(u.id) ? "On the team" : "Add"}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </FormSection>
      ) : null}

      {!disabled ? (
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setList(course.staff)}>
            Discard
          </Button>
          <Button variant={dirty ? "primary" : "outline"} disabled={!dirty || !!problem} loading={save.isPending} onClick={() => save.mutate()} data-testid="staff-save">
            Save team
          </Button>
        </div>
      ) : null}
    </div>
  );
}
