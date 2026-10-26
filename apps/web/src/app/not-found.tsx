import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="text-3xl font-bold tracking-tight">This page is not available</h1>
      <p className="max-w-md text-muted-foreground">The link may be broken, or the page may have been removed. Check the address, or head back to your feed.</p>
      <Link href="/" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        Go to the home page
      </Link>
    </main>
  );
}
