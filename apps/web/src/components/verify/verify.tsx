"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Download, ShieldAlert } from "lucide-react";
import type { Certificate } from "@open-lms/types";
import { Badge, Button, Field, Input, Skeleton, toast } from "@open-lms/ui";
import { isApiError } from "@open-lms/api-client";
import { ErrorState, NotFoundState } from "@/components/common/states";
import { Page, PageHeader } from "@/components/shell/layouts";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";

/** Serials are printed in upper case with dashes; accept what people type or paste. */
export function normaliseSerial(raw: string): string {
  const t = raw.trim();
  const fromUrl = t.match(/\/verify\/([^/?#\s]+)/);
  return (fromUrl ? decodeURIComponent(fromUrl[1]!) : t).replace(/\s+/g, "").toUpperCase();
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "long" });

/** /verify: enter a serial. */
export function VerifyForm() {
  const router = useRouter();
  const [serial, setSerial] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Page width="reading">
      <PageHeader title="Check a certificate" lead="Enter the serial printed on the certificate, or paste its verification link, to see whether it is genuine." />
      <form
        className="flex max-w-lg flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          const s = normaliseSerial(serial);
          if (!s) {
            setError("Enter the certificate serial.");
            return;
          }
          router.push(`/verify/${encodeURIComponent(s)}`);
        }}
      >
        <Field label="Certificate serial" htmlFor="serial" error={error} className="flex-1">
          <Input
            id="serial"
            value={serial}
            onChange={(e) => {
              setSerial(e.target.value);
              setError(null);
            }}
            placeholder="For example ABCD-1234-EFGH"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={error ? "serial-error" : undefined}
            data-testid="verify-serial"
          />
        </Field>
        <Button type="submit" className="sm:mt-[26px]" data-testid="verify-submit">
          Check
        </Button>
      </form>
    </Page>
  );
}

/** /verify/[serial]: the public verification page. */
export function CertificateView({ serial, initial }: { serial: string; initial: Certificate | null }) {
  const { status } = useAuth();
  const q = useQuery({
    queryKey: qk.certificate(serial),
    queryFn: () => api().certificates.verify(serial),
    initialData: initial ?? undefined,
    // Signed in: refetch once so the owner gets their PDF link.
    staleTime: status === "signed-in" ? 0 : 60_000,
    enabled: status !== "loading",
  });
  const [downloading, setDownloading] = useState(false);

  if (q.isError && !q.data) {
    if (isApiError(q.error) && q.error.status === 404) {
      return (
        <Page width="reading">
          <NotFoundState title="No certificate has this serial" description="Check the serial for typos. Serials are printed at the bottom of every certificate." />
          <p className="text-center text-[14px]">
            <Link href="/verify" className="font-semibold text-link hover:underline">
              Try another serial
            </Link>
          </p>
        </Page>
      );
    }
    return (
      <Page width="reading">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );
  }
  if (!q.data) {
    return (
      <Page width="reading">
        <Skeleton className="aspect-[1.414] w-full rounded-card" />
      </Page>
    );
  }
  const c = q.data;

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await api().certificates.downloadPdf(c.serial);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `certificate-${c.serial}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast.error({ title: errorMessage(e) });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Page width="reading" className="max-w-[880px]">
      <div className="mb-6 flex flex-wrap items-center gap-3" role="status" data-testid="verify-status">
        {c.revoked ? (
          <>
            <Badge tone="danger" size="md">
              <ShieldAlert /> Revoked
            </Badge>
            <p className="text-[14px] text-foreground">This certificate was revoked{c.revokedAt ? ` on ${longDate(c.revokedAt)}` : ""} and is no longer valid.</p>
          </>
        ) : (
          <>
            <Badge tone="success" size="md">
              <BadgeCheck /> Valid
            </Badge>
            <p className="text-[14px] text-muted-foreground">
              Issued by {c.academyName} on {longDate(c.issuedAt)}.
            </p>
          </>
        )}
      </div>

      <article className="relative overflow-hidden rounded-card bg-card px-6 py-12 text-center shadow-card sm:px-14 sm:py-16" aria-label={`Certificate ${c.serial}`} data-testid="certificate">
        <div aria-hidden className="pointer-events-none absolute inset-3 rounded-[14px] border border-border sm:inset-4" />
        <p className="text-[12.5px] font-semibold uppercase tracking-[0.18em] text-primary">{c.academyName}</p>
        <p className="mt-8 text-[13px] uppercase tracking-[0.14em] text-subtle-foreground">Certificate of completion</p>
        <p className="mt-6 text-[14.5px] text-muted-foreground">This certifies that</p>
        <h1 className={`mt-2 text-balance font-display text-[34px] font-semibold leading-tight tracking-[-0.02em] sm:text-[46px] ${c.revoked ? "text-muted-foreground line-through decoration-1" : ""}`} data-testid="certificate-learner">
          {c.learnerName}
        </h1>
        <p className="mt-5 text-[14.5px] text-muted-foreground">has completed the course</p>
        <p className="mt-2 text-balance font-display text-[22px] font-semibold tracking-[-0.01em] sm:text-[26px]">
          <Link href={`/courses/${encodeURIComponent(c.courseSlug)}`} className="hover:text-primary">
            {c.courseTitle}
          </Link>
        </p>
        {c.instructorNames.length ? <p className="mt-3 text-[14px] text-muted-foreground">Taught by {c.instructorNames.join(", ")}</p> : null}
        <div className="mx-auto mt-10 grid max-w-md grid-cols-2 gap-6 border-t border-border pt-6 text-left text-[13px]">
          <div>
            <p className="text-subtle-foreground">Issued</p>
            <p className="mt-0.5 font-semibold">{longDate(c.issuedAt)}</p>
          </div>
          <div>
            <p className="text-subtle-foreground">Serial</p>
            <p className="mt-0.5 break-all font-mono font-semibold">{c.serial}</p>
          </div>
        </div>
      </article>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {c.pdfUrl && !c.revoked ? (
          <Button onClick={() => void download()} loading={downloading} data-testid="certificate-download">
            <Download /> Download PDF
          </Button>
        ) : null}
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(c.verifyUrl).then(
              () => toast.success({ title: "Link copied" }),
              () => toast.error({ title: "Could not copy. Copy the address from your browser instead." }),
            );
          }}
        >
          Copy verification link
        </Button>
        <Link href="/verify" className="text-[14px] font-semibold text-link hover:underline">
          Check another certificate
        </Link>
      </div>
    </Page>
  );
}
