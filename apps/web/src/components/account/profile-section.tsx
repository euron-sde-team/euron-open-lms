"use client";

import { useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Camera, X } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import { Avatar, Button, Field, Input, NativeSelect, Spinner, Textarea, toast } from "@open-lms/ui";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useUploads } from "@/lib/hooks/use-uploads";
import { useAcademyMeta } from "@/lib/meta";
import { AccountSection, SectionTitle } from "./section";

const optionalText = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`);

const schema = z.object({
  displayName: z.string().trim().min(1, "Enter your name").max(80, "Use at most 80 characters"),
  certificateName: optionalText(120),
  headline: optionalText(120),
  bio: optionalText(2000),
  website: z
    .string()
    .trim()
    .max(300)
    .refine((v) => !v || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), "Enter a full link starting with https://"),
  preferredCurrency: z.string(),
});
type Values = z.infer<typeof schema>;

const nullable = (v: string) => (v.trim() ? v.trim() : null);

/** What a certificate prints: the certificate name, else the display name. */
export const certificateNameFor = (v: { certificateName: string; displayName: string }) => v.certificateName.trim() || v.displayName.trim();

function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function ProfileSection() {
  const me = useMe();
  const { setUser } = useAuth();
  const meta = useAcademyMeta();
  const avatar = useUploads("AVATAR", { max: 1, accept: (m) => m.startsWith("image/") });
  const avatarRef = useRef<HTMLInputElement>(null);
  const values: Values = {
    displayName: me.displayName,
    certificateName: me.certificateName ?? "",
    headline: me.headline ?? "",
    bio: me.bio ?? "",
    website: me.website ?? "",
    preferredCurrency: me.preferredCurrency ?? "",
  };
  const form = useForm<Values>({ resolver: zodResolver(schema), values, resetOptions: { keepDirtyValues: true } });
  const errs = form.formState.errors;
  const watched = form.watch();
  const preview = certificateNameFor(watched);

  const onSubmit = async (v: Values) => {
    try {
      const updated = await api().users.updateMe({
        displayName: v.displayName.trim(),
        certificateName: nullable(v.certificateName),
        headline: nullable(v.headline),
        bio: nullable(v.bio),
        website: nullable(v.website),
        preferredCurrency: v.preferredCurrency || null,
        ...(avatar.mediaIds[0] ? { avatarUploadId: avatar.mediaIds[0] } : {}),
      });
      setUser(updated);
      avatar.reset();
      form.reset(v);
      toast.success({ title: "Profile saved" });
    } catch (e) {
      if (isApiError(e) && e.code === "VALIDATION_FAILED") {
        for (const [path, msg] of Object.entries(e.fieldErrors)) if (path in v) form.setError(path as keyof Values, { message: msg });
      } else if (isApiError(e) && e.code === "CERTIFICATE_NAME_INVALID") {
        form.setError("certificateName", { message: errorMessage(e) });
        return;
      } else if (isApiError(e) && e.code === "URL_INVALID") {
        form.setError("website", { message: errorMessage(e) });
        return;
      }
      toast.error({ title: "Could not save", description: errorMessage(e) });
    }
  };

  const avatarPreview = avatar.items[0]?.previewUrl ?? me.avatarUrl;
  const dirty = form.formState.isDirty || avatar.mediaIds.length > 0;
  const currencies = meta.data?.currencies ?? [];

  return (
    <div>
      <SectionTitle title="Profile" lead="How you appear to instructors and other learners, and the name on your certificates." />
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <AccountSection title="Photo and name">
          <div className="flex items-start gap-5">
            <div className="relative shrink-0">
              <Avatar name={me.displayName} seed={me.id} src={avatarPreview} size="xl" />
              {avatar.busy ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-overlay/40">
                  <Spinner className="text-white" />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                aria-label="Change profile photo"
                data-testid="avatar-upload"
                className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-card hover:bg-muted"
              >
                <Camera className="size-4" />
              </button>
              <input
                ref={avatarRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) {
                    avatar.items.forEach((i) => avatar.remove(i.localId));
                    avatar.add(e.target.files);
                  }
                  e.target.value = "";
                }}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <Field label="Display name" htmlFor="displayName" error={errs.displayName?.message}>
                <Input id="displayName" autoComplete="name" {...form.register("displayName")} aria-invalid={!!errs.displayName || undefined} data-testid="profile-display-name" />
              </Field>
              {avatar.items.length ? (
                <Button size="sm" variant="ghost" onClick={() => avatar.remove(avatar.items[0]!.localId)}>
                  <X /> Undo photo change
                </Button>
              ) : null}
              {avatar.failed ? <p className="text-sm text-danger">The upload failed. Pick another image.</p> : null}
            </div>
          </div>
        </AccountSection>

        <AccountSection title="Certificate name" description="Your full name as it should be printed. Leave it empty to use your display name.">
          <div className="max-w-[460px] space-y-3">
            <Field label="Name on certificates" htmlFor="certificateName" error={errs.certificateName?.message} optional>
              <Input id="certificateName" {...form.register("certificateName")} aria-invalid={!!errs.certificateName || undefined} data-testid="profile-certificate-name" />
            </Field>
            <div className="border-l-2 border-border pl-4" data-testid="certificate-preview">
              <p className="text-[12.5px] text-muted-foreground">This is how your name appears on certificates</p>
              <p className="mt-1 font-display text-[22px] font-semibold tracking-[-0.01em]">{preview || "Your name"}</p>
            </div>
          </div>
        </AccountSection>

        <AccountSection title="About you" description="Shown next to your reviews and questions.">
          <div className="max-w-[560px] space-y-4">
            <Field label="Headline" htmlFor="headline" hint="One line, for example: Data analyst learning machine learning" error={errs.headline?.message} optional>
              <Input id="headline" {...form.register("headline")} data-testid="profile-headline" />
            </Field>
            <Field label="Bio" htmlFor="bio" error={errs.bio?.message} optional>
              <Textarea id="bio" rows={4} {...form.register("bio")} data-testid="profile-bio" />
            </Field>
            <Field label="Website" htmlFor="website" error={errs.website?.message} optional>
              <Input id="website" type="url" inputMode="url" placeholder="https://" {...form.register("website")} data-testid="profile-website" />
            </Field>
          </div>
        </AccountSection>

        {currencies.length > 1 ? (
          <AccountSection title="Display currency" description="Prices across the catalog are shown in this currency when it is on sale in it.">
            <div className="max-w-[320px]">
              <Field label="Preferred currency" htmlFor="preferredCurrency">
                <NativeSelect id="preferredCurrency" {...form.register("preferredCurrency")} data-testid="profile-currency">
                  <option value="">Academy default ({meta.data?.defaultCurrency})</option>
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c} · {currencyName(c)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </AccountSection>
        ) : null}

        <div className="pt-2">
          <Button type="submit" loading={form.formState.isSubmitting} disabled={!dirty || avatar.busy || avatar.failed} data-testid="profile-save">
            {avatar.busy ? "Uploading..." : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
