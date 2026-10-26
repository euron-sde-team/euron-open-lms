"use client";

import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@open-lms/ui";

export const PasswordInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={show ? "text" : "password"} className="pr-10" {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-subtle-foreground hover:bg-muted hover:text-foreground"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
});

/** 0..4 rough strength score for the hint under the password field. */
export function passwordScore(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}

const LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"];
const TONES = ["bg-danger", "bg-danger", "bg-warning", "bg-success", "bg-success"];

export function StrengthMeter({ value }: { value: string }) {
  const score = value.length < 10 ? 0 : Math.max(1, passwordScore(value));
  return (
    <div className="mt-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i <= score ? TONES[score] : "bg-muted"}`} />
        ))}
      </div>
      <p className="mt-1 text-xs text-subtle-foreground">
        {value ? LABELS[score] : "At least 10 characters"}. Longer is stronger; avoid common words.
      </p>
    </div>
  );
}
