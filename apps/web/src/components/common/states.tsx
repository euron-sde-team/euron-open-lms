"use client";

import Link from "next/link";
import { AlertTriangle, Lock, SearchX } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import { Button, Card, EmptyState, Spinner, cn } from "@open-lms/ui";
import { errorMessage } from "@/lib/errors";

/** Inline error for a failed query, with a retry. 404s read as "not found", not as an error. */
export function ErrorState({ error, onRetry, className, compact }: { error: unknown; onRetry?: () => void; className?: string; compact?: boolean }) {
  if (isApiError(error) && error.status === 404) return <NotFoundState className={className} compact={compact} />;
  return (
    <EmptyState
      compact={compact}
      className={className}
      icon={<AlertTriangle />}
      title="That did not load"
      description={errorMessage(error)}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}

export function NotFoundState({ className, compact, title = "This page is not available", description }: { className?: string; compact?: boolean; title?: string; description?: string }) {
  return (
    <EmptyState
      compact={compact}
      className={className}
      icon={<SearchX />}
      title={title}
      description={description ?? "The link may be broken, or the content may have been removed or made private."}
      action={
        <Button asChild variant="soft" size="sm">
          <Link href="/">Go to the home page</Link>
        </Button>
      }
    />
  );
}

export function SignedOutState({ title = "Sign in to see this", description }: { title?: string; description?: string }) {
  return (
    <Card className="mx-auto max-w-md">
      <EmptyState
        icon={<Lock />}
        title={title}
        description={description ?? "Sign in to pick up where you left off, keep your progress and earn certificates."}
        action={
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/signup">Create account</Link>
            </Button>
          </div>
        }
      />
    </Card>
  );
}

/** Sentinel + spinner at the end of an infinite list. */
export function LoadMore({
  sentinelRef,
  loading,
  hasMore,
  onClick,
  endLabel,
  className,
}: {
  sentinelRef: React.Ref<HTMLDivElement>;
  loading: boolean;
  hasMore: boolean;
  onClick?: () => void;
  endLabel?: string;
  className?: string;
}) {
  return (
    <div ref={sentinelRef} className={cn("flex min-h-10 items-center justify-center py-3", className)}>
      {loading ? (
        <Spinner />
      ) : hasMore && onClick ? (
        <Button variant="ghost" size="sm" onClick={onClick}>
          Load more
        </Button>
      ) : !hasMore && endLabel ? (
        <p className="text-xs text-subtle-foreground">{endLabel}</p>
      ) : null}
    </div>
  );
}

export function PageTitle({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
