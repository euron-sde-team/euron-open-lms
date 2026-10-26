"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, UserRound } from "lucide-react";
import { CountBadge, cn } from "@open-lms/ui";
import { useAuth } from "@/lib/auth";
import { useCounts } from "@/lib/hooks/queries";
import { HOME_NAV } from "./nav-items";
import { useNavItems } from "./header";

/** Mobile tab bar (below md), signed in only. */
export function BottomNav() {
  const pathname = usePathname() ?? "/";
  const { status } = useAuth();
  const nav = useNavItems();
  const unread = useCounts().data?.notifications ?? 0;
  if (status !== "signed-in") return null;
  const items = [
    HOME_NAV,
    ...nav.filter((n) => n.href !== "/plans"),
    { href: "/notifications", label: "Alerts", icon: Bell, match: (p: string) => p.startsWith("/notifications") },
    { href: "/account", label: "Account", icon: UserRound, match: (p: string) => p.startsWith("/account") },
  ];
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = item.match(pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-foreground" : "text-muted-foreground")}
              >
                <item.icon className="size-[21px]" strokeWidth={active ? 2.3 : 1.9} />
                {item.label}
                {item.href === "/notifications" ? <CountBadge count={unread} className="absolute left-1/2 top-1.5 ml-1.5" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
