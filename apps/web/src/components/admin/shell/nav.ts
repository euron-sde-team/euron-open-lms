/** The admin sidebar model: groups of areas, filtered by what the session permits. Pure (tested). */
import {
  Award, BookOpen, ClipboardCheck, FolderTree, Gauge, Package, Receipt, ScrollText, Settings2, ShieldAlert, Ticket, UserCog, Users, type LucideIcon,
} from "lucide-react";
import type { AdminArea, AdminSession } from "@open-lms/types";

export interface AdminNavItem {
  /** The permission that opens it. */
  area: AdminArea;
  href: string;
  label: string;
  icon: LucideIcon;
  /** Extra condition beyond the area permission. */
  requires?: (s: AdminSession) => boolean;
}

export interface AdminNavGroup {
  label: string | null;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  { label: null, items: [{ area: "overview", href: "/admin", label: "Overview", icon: Gauge }] },
  {
    label: "Teaching",
    items: [
      { area: "courses", href: "/admin/courses", label: "Courses", icon: BookOpen },
      // Categories are academy-wide: only roles that see every course read them.
      { area: "courses", href: "/admin/categories", label: "Categories", icon: FolderTree, requires: (s) => s.allCourses },
      { area: "grading", href: "/admin/grading", label: "Grading", icon: ClipboardCheck },
    ],
  },
  {
    label: "Learners",
    items: [
      { area: "learners", href: "/admin/learners", label: "Learners", icon: Users },
      { area: "certificates", href: "/admin/certificates", label: "Certificates", icon: Award },
      { area: "moderation", href: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
    ],
  },
  {
    label: "Commerce",
    items: [
      { area: "orders", href: "/admin/orders", label: "Orders", icon: Receipt },
      { area: "plans", href: "/admin/plans", label: "Plans and bundles", icon: Package },
      { area: "coupons", href: "/admin/coupons", label: "Coupons", icon: Ticket },
    ],
  },
  {
    label: "Academy",
    items: [
      { area: "staff", href: "/admin/staff", label: "Staff", icon: UserCog },
      { area: "settings", href: "/admin/settings", label: "Settings", icon: Settings2 },
      { area: "audit", href: "/admin/audit", label: "Audit log", icon: ScrollText },
    ],
  },
];

/** The groups and items this session may open; empty groups are dropped. */
export function visibleNav(session: AdminSession, nav: AdminNavGroup[] = ADMIN_NAV): AdminNavGroup[] {
  return nav
    .map((g) => ({ ...g, items: g.items.filter((i) => session.permissions[i.area] && (!i.requires || i.requires(session))) }))
    .filter((g) => g.items.length > 0);
}

/** The item a pathname belongs to: the longest matching href ("/admin" only matches itself). */
export function activeNavHref(pathname: string, groups: AdminNavGroup[]): string | null {
  let best: string | null = null;
  for (const g of groups)
    for (const i of g.items) {
      const hit = i.href === "/admin" ? pathname === "/admin" : pathname === i.href || pathname.startsWith(`${i.href}/`);
      if (hit && (!best || i.href.length > best.length)) best = i.href;
    }
  return best;
}

/** The area a pathname needs, for the per-page 403 ("/admin/learners/x" needs "learners"). */
export function areaForPath(pathname: string): AdminArea | null {
  const seg = pathname.replace(/^\/admin\/?/, "").split("/")[0] ?? "";
  if (!seg) return "overview";
  if (seg === "categories") return "courses";
  if (seg === "bundles" || seg === "subscriptions") return "plans";
  const item = ADMIN_NAV.flatMap((g) => g.items).find((i) => i.href === `/admin/${seg}`);
  return item?.area ?? null;
}

/** "Teach" for instructors, "Admin" for everyone else. */
export function consoleTitle(role: AdminSession["role"]): string {
  return role === "INSTRUCTOR" ? "Teach" : "Admin";
}
