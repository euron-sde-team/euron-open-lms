"use client";

import Link from "next/link";
import { HeartHandshake } from "lucide-react";
import { Button } from "@open-lms/ui";
import { useProductName } from "@/lib/meta";
import { AuthHeading } from "./auth-shell";

export function Goodbye() {
  const name = useProductName();
  return (
    <div className="text-center" data-testid="goodbye">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <HeartHandshake className="size-6" />
      </div>
      <AuthHeading
        title="Your account will be deleted"
        description={`You are signed out everywhere. ${name} erases your data in 14 days; sign in before then if you change your mind.`}
      />
      <Button asChild variant="outline" block>
        <Link href="/courses">Browse courses</Link>
      </Button>
    </div>
  );
}
