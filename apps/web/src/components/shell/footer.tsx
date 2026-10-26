"use client";

import Link from "next/link";
import { useAcademyMeta, useProductName } from "@/lib/meta";

/** The site footer: plain columns of links on a hairline, the academy name, the year. */
export function Footer() {
  const name = useProductName();
  const meta = useAcademyMeta().data;
  const year = new Date().getFullYear();
  const columns = [
    { title: "Learn", links: [{ href: "/courses", label: "All courses" }, { href: "/bundles", label: "Bundles" }, ...(meta?.subscriptions ? [{ href: "/plans", label: "Plans" }] : [])] },
    { title: "Your learning", links: [{ href: "/my-learning", label: "My learning" }, { href: "/my-learning?tab=certificates", label: "Certificates" }, { href: "/account/orders", label: "Orders" }] },
    { title: "Help", links: [{ href: "/verify", label: "Verify a certificate" }, ...(meta?.support.email ? [{ href: `mailto:${meta.support.email}`, label: "Contact support" }] : [])] },
  ];
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <p className="font-display text-lg font-semibold tracking-tight">{name}</p>
          {meta?.tagline ? <p className="mt-2 max-w-xs text-[13.5px] text-muted-foreground">{meta.tagline}</p> : null}
        </div>
        {columns.map((c) => (
          <div key={c.title}>
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-subtle-foreground">{c.title}</p>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-[14px] text-muted-foreground transition-colors hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-[1200px] px-4 pb-10 text-[12.5px] text-subtle-foreground sm:px-6">
        © {year} {name}
      </div>
    </footer>
  );
}
