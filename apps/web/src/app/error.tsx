"use client";

import { useEffect } from "react";
import { Button } from "@open-lms/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface in the browser console for bug reports; no user content is logged.
    // eslint-disable-next-line no-console
    console.error(error.digest ?? error.name);
  }, [error]);
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground">This part of the page hit a problem. Try again, and if it keeps happening, reload the page.</p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </main>
  );
}
