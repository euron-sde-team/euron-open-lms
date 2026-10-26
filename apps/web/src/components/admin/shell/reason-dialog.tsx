"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Textarea } from "@open-lms/ui";
import { errorMessage } from "@/lib/errors";

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Reason field: required (3+ characters, the API minimum), optional, or hidden. */
  reason?: "required" | "optional" | "none";
  reasonLabel?: string;
  reasonHint?: string;
  /** Show a "days" input with this default. */
  days?: number;
  maxDays?: number;
  /** The operator types this text before the button enables (irreversible actions). */
  typeToConfirm?: string;
  /** Extra validity from fields passed as children. */
  canConfirm?: boolean;
  children?: ReactNode;
  /** Throw to keep the dialog open; the error shows inline. */
  onConfirm: (input: { reason: string; days: number }) => Promise<unknown>;
  testId?: string;
}

/** Recorded or destructive actions: a reason, optional days, an optional typed confirmation. */
export function ReasonDialog(p: ReasonDialogProps) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(String(p.days ?? 7));
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (p.open) {
      setReason("");
      setTyped("");
      setError(null);
      setDays(String(p.days ?? 7));
    }
  }, [p.open, p.days]);
  const mode = p.reason ?? "required";
  const max = p.maxDays ?? 365;
  const dayCount = Number(days);
  const daysOk = p.days === undefined || (Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= max);
  const reasonOk = mode !== "required" || reason.trim().length >= 3;
  const typedOk = !p.typeToConfirm || typed.trim() === p.typeToConfirm;
  const ok = daysOk && reasonOk && typedOk && p.canConfirm !== false;
  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await p.onConfirm({ reason: reason.trim(), days: dayCount });
      p.onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={p.open} onOpenChange={(o) => !busy && p.onOpenChange(o)}>
      <DialogContent size="sm" data-testid={p.testId ?? "reason-dialog"}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{p.title}</DialogTitle>
            {p.description ? <DialogDescription>{p.description}</DialogDescription> : null}
          </DialogHeader>
          <DialogBody className="space-y-4">
            {p.children}
            {p.days !== undefined ? (
              <Field label="Days" htmlFor={`${id}-days`} error={daysOk ? undefined : `Between 1 and ${max} days.`}>
                <Input id={`${id}-days`} type="number" inputMode="numeric" min={1} max={max} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" data-testid="reason-days" />
              </Field>
            ) : null}
            {mode !== "none" ? (
              <Field label={p.reasonLabel ?? "Reason"} htmlFor={`${id}-reason`} optional={mode === "optional"} hint={p.reasonHint ?? "Recorded in the audit log."}>
                <Textarea id={`${id}-reason`} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reason-input" />
              </Field>
            ) : null}
            {p.typeToConfirm ? (
              <Field
                label={
                  <span>
                    Type <span className="font-mono text-[13px] font-semibold">{p.typeToConfirm}</span> to confirm
                  </span>
                }
                htmlFor={`${id}-typed`}
              >
                <Input id={`${id}-typed`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="reason-typed" />
              </Field>
            ) : null}
            {error ? (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => p.onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant={p.destructive ? "danger" : "primary"} disabled={!ok} loading={busy} data-testid="reason-confirm">
              {p.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
