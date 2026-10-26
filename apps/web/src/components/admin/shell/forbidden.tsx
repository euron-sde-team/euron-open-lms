"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { Button, EmptyState } from "@open-lms/ui";

/** The friendly 403: for learners at /admin, and for areas a role does not include. */
export function ForbiddenArea({
  title = "You do not have access",
  description = "Your role does not include this area. Ask an administrator if you need it.",
  homeHref = "/",
  homeLabel = "Back to the academy",
}: {
  title?: string;
  description?: string;
  homeHref?: string;
  homeLabel?: string;
}) {
  return (
    <div className="mx-auto max-w-lg py-16" data-testid="admin-forbidden">
      <EmptyState
        icon={<Lock />}
        title={title}
        description={description}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
        }
      />
    </div>
  );
}
