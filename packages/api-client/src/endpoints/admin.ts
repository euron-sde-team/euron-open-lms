/** Admin operations endpoints (admin.routes.ts). See docs/api/rest-contract.md "Admin: operations". */
import type {
  AdminCertificateRow, AdminDownloadRow, AdminEnrollment, AdminLearnerDetail, AdminSession, AdminStats, AdminUserRow, AuditEntry,
  IntegrationStatus, LmsSettings, Page, StaffRow, UserRole, UserStatus,
} from "@open-lms/types";
import { enc, type Helpers, type PageQuery } from "./helpers";

export interface StatsRangeQuery {
  /** Local dates (YYYY-MM-DD) in the analytics time zone; default the last 30 days. */
  from?: string;
  to?: string;
}

export interface AdminLearnersQuery extends PageQuery {
  q?: string;
  status?: UserStatus;
}

export interface AdminGrantInput {
  courseId: string;
  /** ISO timestamp in the future, or null / omitted for lifetime access. */
  validUntil?: string | null;
  note?: string | null;
}

export interface AdminStaffQuery extends PageQuery {
  role?: Exclude<UserRole, "LEARNER">;
  q?: string;
}

export interface AdminAuditQuery extends PageQuery {
  /** A prefix: "enrollment." matches every enrollment action. */
  action?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
}

/** Any subset of the settings groups; inside a group, any subset of its fields. */
export type AdminSettingsPatch = {
  [K in Exclude<keyof LmsSettings, "learning">]?: LmsSettings[K] extends Record<string, unknown> ? Partial<LmsSettings[K]> : LmsSettings[K];
} & {
  learning?: Partial<Omit<LmsSettings["learning"], "offline">> & { offline?: Partial<LmsSettings["learning"]["offline"]> };
};

export function adminEndpoints(h: Helpers) {
  const { get, post, patch, pq, download } = h;
  const learner = (id: string) => `/admin/learners/${enc(id)}`;
  return {
    admin: {
      /** The operator session. 403 FORBIDDEN_AREA for learners. */
      me: (signal?: AbortSignal) => get<AdminSession>("/admin/me", undefined, signal),
      stats: (q?: StatsRangeQuery) => get<AdminStats>("/admin/stats", pq(q)),
      /** The daily series as a CSV file. */
      statsCsv: (q?: StatsRangeQuery) => download("/admin/stats.csv", pq(q)),

      learners: (q?: AdminLearnersQuery) => get<Page<AdminUserRow>>("/admin/learners", pq(q)),
      learner: (id: string) => get<AdminLearnerDetail>(learner(id)),
      grantEnrollment: (userId: string, body: AdminGrantInput) => post<AdminEnrollment>(`${learner(userId)}/enrollments`, body),
      revokeEnrollment: (enrollmentId: string, reason: string) => post<AdminEnrollment>(`/admin/enrollments/${enc(enrollmentId)}/revoke`, { reason }),
      setEnrollmentValidUntil: (enrollmentId: string, validUntil: string | null) => patch<AdminEnrollment>(`/admin/enrollments/${enc(enrollmentId)}`, { validUntil }),
      /** The learner's offline downloads (mobile app), newest first. */
      learnerDownloads: (userId: string, q?: PageQuery) => get<Page<AdminDownloadRow>>(`${learner(userId)}/downloads`, pq(q)),
      /** The app deletes the copy at its next check. 409 DOWNLOAD_REVOKED. */
      revokeDownload: (downloadId: string) => post<AdminDownloadRow>(`/admin/downloads/${enc(downloadId)}/revoke`, {}),
      suspend: (userId: string, body: { days: number; reason: string }) => post<AdminUserRow>(`${learner(userId)}/suspend`, body),
      unsuspend: (userId: string) => post<AdminUserRow>(`${learner(userId)}/unsuspend`),
      ban: (userId: string, reason: string) => post<AdminUserRow>(`${learner(userId)}/ban`, { reason }),
      unban: (userId: string) => post<AdminUserRow>(`${learner(userId)}/unban`),
      /** ADMIN only. 409 SUBSCRIPTION_ACTIVE until the learner's subscription is cancelled. */
      erase: (userId: string, reason: string) => post(`${learner(userId)}/erase`, { reason }),

      certificates: (q?: PageQuery & { q?: string }) => get<Page<AdminCertificateRow>>("/admin/certificates", pq(q)),
      revokeCertificate: (id: string, reason: string) => post<AdminCertificateRow>(`/admin/certificates/${enc(id)}/revoke`, { reason }),
      restoreCertificate: (id: string) => post<AdminCertificateRow>(`/admin/certificates/${enc(id)}/restore`),

      staff: (q?: AdminStaffQuery) => get<Page<StaffRow>>("/admin/staff", pq(q)),
      /** 409 LAST_ADMIN, USER_INACTIVE; 403 CANNOT_CHANGE_OWN_ROLE. */
      changeRole: (userId: string, role: UserRole) => patch<StaffRow>(`/admin/staff/${enc(userId)}`, { role }),

      settings: () => get<LmsSettings>("/admin/settings"),
      updateSettings: (body: AdminSettingsPatch) => patch<LmsSettings>("/admin/settings", body),
      integrations: () => get<IntegrationStatus>("/admin/integrations"),
      testEvs: () => post<{ ok: boolean; message: string }>("/admin/integrations/evs/test"),

      audit: (q?: AdminAuditQuery) => get<Page<AuditEntry>>("/admin/audit", pq(q)),
    },
  };
}
