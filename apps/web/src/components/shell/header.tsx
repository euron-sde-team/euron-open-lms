"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button, Dialog, DialogContent, DialogTitle, IconButton, cn } from "@open-lms/ui";
import { useAuth } from "@/lib/auth";
import { useAcademyMeta } from "@/lib/meta";
import { Wordmark } from "@/components/common/wordmark";
import { AvatarMenu } from "./avatar-menu";
import { NotificationsBell } from "./notifications-bell";
import { PRIMARY_NAV } from "./nav-items";

/** The nav entries this visitor sees: Plans only while one is on sale, My learning only signed in. */
export function useNavItems() {
  const { status } = useAuth();
  const plans = !!useAcademyMeta().data?.subscriptions;
  return PRIMARY_NAV.filter((n) => (!n.signedInOnly || status === "signed-in") && (!n.plans || plans));
}

/** One search field for the whole catalog: it lands on /courses?q=. */
export function CourseSearch({ className, autoFocus, onDone }: { className?: string; autoFocus?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/courses?q=${encodeURIComponent(term)}` : "/courses");
    onDone?.();
  };
  return (
    <form role="search" onSubmit={submit} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus={autoFocus}
        placeholder="Search courses"
        aria-label="Search courses"
        data-testid="header-search"
        className="h-10 w-full rounded-[10px] bg-ground-2 pl-9 pr-3 text-sm text-foreground placeholder:text-subtle-foreground focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </form>
  );
}

export function Header() {
  const pathname = usePathname() ?? "/";
  const { status } = useAuth();
  const items = useNavItems();
  const [searchOpen, setSearchOpen] = useState(false);
  const signedIn = status === "signed-in";
  return (
    <header className="sticky top-0 z-50 h-header border-b border-border/70 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-full max-w-[1200px] items-center gap-4 px-4 sm:px-6">
        <Wordmark className="shrink-0" textClassName={status === "signed-out" ? "hidden sm:inline" : "hidden sm:inline"} />

        <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
          {items.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                data-testid={`nav-${item.href.slice(1)}`}
                className={cn("relative py-2 text-[14.5px] font-medium transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {item.label}
                <span aria-hidden className={cn("absolute inset-x-0 -bottom-[13px] h-0.5 rounded-full", active ? "bg-ink" : "bg-transparent")} />
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2">
          <CourseSearch className="hidden w-full max-w-[300px] lg:block" />
          <IconButton label="Search courses" variant="ghost" size="md" className="lg:hidden" onClick={() => setSearchOpen(true)}>
            <Search />
          </IconButton>
          {signedIn ? (
            <>
              <NotificationsBell />
              <AvatarMenu />
            </>
          ) : status === "signed-out" ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/login?next=${encodeURIComponent(pathname)}`}>Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Start learning</Link>
              </Button>
            </>
          ) : (
            <span className="size-9 animate-shimmer rounded-full bg-muted" aria-hidden />
          )}
        </div>
      </div>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="top-4 translate-y-0 p-4" hideClose>
          <DialogTitle className="sr-only">Search courses</DialogTitle>
          <CourseSearch autoFocus onDone={() => setSearchOpen(false)} />
        </DialogContent>
      </Dialog>
    </header>
  );
}
