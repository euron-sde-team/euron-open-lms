import { Header } from "@/components/shell/header";
import { BottomNav } from "@/components/shell/bottom-nav";
import { Footer } from "@/components/shell/footer";
import { RestrictionBanner } from "@/components/shell/restriction-banner";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only z-[100] rounded-md bg-card px-3 py-2 font-semibold focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <Header />
      <RestrictionBanner />
      <div className="pb-16 md:pb-0">{children}</div>
      <Footer />
      <BottomNav />
    </>
  );
}
