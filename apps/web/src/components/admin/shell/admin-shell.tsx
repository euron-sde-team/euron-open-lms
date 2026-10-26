"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import { DialogTitle, IconButton, Sheet, SheetContent, Skeleton, Tooltip, cn } from "@open-lms/ui";
import type { AdminSession } from "@open-lms/types";
import { useProductName } from "@/lib/meta";
import { RequireAuth } from "@/components/common/require-auth";
import { ErrorState } from "@/components/common/states";
import { LogoMark } from "@/components/common/wordmark";
import { AvatarMenu } from "@/components/shell/avatar-menu";
import { ForbiddenArea } from "./forbidden";
import { activeNavHref, areaForPath, consoleTitle, visibleNav, type AdminNavGroup } from "./nav";
import { AdminSessionProvider, useAdminSessionQuery } from "./session";

const COLLAPSE_KEY = "lms.admin.sidebar";

/** The /admin frame: permission-filtered sidebar (icons on md, a sheet on phones), top bar, content. */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <ShellInner>{children}</ShellInner>
    </RequireAuth>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const q = useAdminSessionQuery();
  if (q.isPending) return <ShellSkeleton />;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 403)
      return <ForbiddenArea title="You do not have access" description="This part of the academy is for instructors and staff. Your courses are waiting in My learning." homeHref="/my-learning" homeLabel="Go to My learning" />;
    return (
      <div className="py-16">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  return (
    <AdminSessionProvider session={q.data}>
      <Frame session={q.data}>{children}</Frame>
    </AdminSessionProvider>
  );
}

function Frame({ session, children }: { session: AdminSession; children: ReactNode }) {
  const pathname = usePathname() ?? "/admin";
  const groups = visibleNav(session);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage blocked: start expanded */
    }
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  const area = areaForPath(pathname);
  const allowed = !area || session.permissions[area];

  return (
    <div className="flex min-h-dvh bg-background">
      <a href="#admin-main" className="sr-only z-[100] rounded-md bg-card px-3 py-2 font-semibold focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <aside
        className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-background md:flex", collapsed ? "w-[64px]" : "w-[232px]")}
        data-testid="admin-sidebar"
      >
        <SidebarHead session={session} collapsed={collapsed} />
        <SideNav groups={groups} pathname={pathname} collapsed={collapsed} />
        <div className={cn("border-t border-border p-2", collapsed && "flex justify-center")}>
          <IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} variant="ghost" size="sm" onClick={toggle} data-testid="admin-sidebar-toggle">
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </IconButton>
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" width="max-w-[280px]" aria-describedby={undefined}>
          <DialogTitle className="sr-only">{consoleTitle(session.role)} areas</DialogTitle>
          <SidebarHead session={session} collapsed={false} />
          <SideNav groups={groups} pathname={pathname} collapsed={false} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar session={session} onMenu={() => setMobileOpen(true)} />
        <main id="admin-main" className="min-w-0 flex-1" tabIndex={-1}>
          {allowed ? children : <ForbiddenArea homeHref="/admin" homeLabel="Back to the overview" />}
        </main>
      </div>
    </div>
  );
}

function SidebarHead({ session, collapsed }: { session: AdminSession; collapsed: boolean }) {
  return (
    <div className={cn("flex h-header shrink-0 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
      <Link href="/admin" className="flex items-center gap-2.5 rounded-md focus-visible:ring-2" aria-label={`${consoleTitle(session.role)} overview`}>
        <LogoMark />
        {collapsed ? null : <span className="font-display text-[18px] font-semibold tracking-[-0.02em]">{consoleTitle(session.role)}</span>}
      </Link>
    </div>
  );
}

function SideNav({ groups, pathname, collapsed }: { groups: AdminNavGroup[]; pathname: string; collapsed: boolean }) {
  const active = activeNavHref(pathname, groups);
  return (
    <nav aria-label="Admin areas" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" data-testid="admin-nav">
      {groups.map((g, gi) => (
        <div key={g.label ?? gi} className={cn(gi > 0 && "mt-5")}>
          {g.label ? (
            collapsed ? (
              <div className="mx-auto mb-2 h-px w-6 bg-border" aria-hidden />
            ) : (
              <p className="mb-1.5 px-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-subtle-foreground">{g.label}</p>
            )
          ) : null}
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const current = active === i.href;
              const link = (
                <Link
                  href={i.href}
                  aria-current={current ? "page" : undefined}
                  aria-label={collapsed ? i.label : undefined}
                  data-testid={`admin-nav-${i.href.split("/")[2] ?? "overview"}`}
                  className={cn(
                    "flex h-9 items-center gap-2.5 rounded-[10px] text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    collapsed ? "justify-center" : "px-3",
                    current ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <i.icon className={cn("size-[18px] shrink-0", current ? "text-primary" : "text-subtle-foreground")} aria-hidden />
                  {collapsed ? null : <span className="truncate">{i.label}</span>}
                </Link>
              );
              return (
                <li key={i.href}>
                  {collapsed ? (
                    <Tooltip content={i.label} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function TopBar({ session, onMenu }: { session: AdminSession; onMenu: () => void }) {
  const name = useProductName();
  return (
    <header className="sticky top-0 z-40 flex h-header shrink-0 items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 sm:px-6">
      <IconButton label="Open menu" variant="ghost" size="md" className="md:hidden" onClick={onMenu} data-testid="admin-menu">
        <Menu />
      </IconButton>
      <p className="min-w-0 truncate text-[14.5px] font-semibold text-foreground" data-testid="admin-academy-name">
        {name}
        <span className="font-normal text-muted-foreground"> · {consoleTitle(session.role)}</span>
      </p>
      <div className="flex flex-1 items-center justify-end gap-3">
        <Link href="/" className="inline-flex items-center gap-1 text-[13.5px] font-medium text-muted-foreground hover:text-foreground" data-testid="admin-view-site">
          View site <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
        <AvatarMenu />
      </div>
    </header>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy>
      <div className="hidden w-[232px] shrink-0 space-y-3 border-r border-border p-4 md:block">
        <Skeleton className="h-8 w-28" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
      <div className="flex-1 space-y-4 p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
