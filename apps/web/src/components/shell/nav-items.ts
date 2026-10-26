import { BookOpen, Compass, GraduationCap, Sparkles } from "lucide-react";

/** The header's primary destinations. `plans` only shows when a plan is on sale. */
export const PRIMARY_NAV = [
  { href: "/courses", label: "Courses", icon: Compass, match: (p: string) => p.startsWith("/courses") || p.startsWith("/bundles") || p.startsWith("/instructors"), signedInOnly: false, plans: false },
  { href: "/plans", label: "Plans", icon: Sparkles, match: (p: string) => p.startsWith("/plans"), signedInOnly: false, plans: true },
  { href: "/my-learning", label: "My learning", icon: GraduationCap, match: (p: string) => p.startsWith("/my-learning"), signedInOnly: true, plans: false },
] as const;

export const HOME_NAV = { href: "/", label: "Home", icon: BookOpen, match: (p: string) => p === "/" } as const;
