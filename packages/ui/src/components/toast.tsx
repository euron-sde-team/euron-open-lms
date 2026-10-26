"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "../lib/cn";

export type ToastTone = "info" | "success" | "error";

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

type Listener = (items: ToastItem[]) => void;

/**
 * A tiny external store so any module (React Query error handlers, the API
 * client) can raise a toast without a hook.
 */
class ToastStore {
  private items: ToastItem[] = [];
  private listeners = new Set<Listener>();
  private nextId = 1;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getSnapshot = () => this.items;

  push(t: Omit<ToastItem, "id">): number {
    const id = this.nextId++;
    // Same message twice in a row: keep one (a burst of failing queries).
    if (this.items.some((i) => i.title === t.title && i.description === t.description)) return id;
    this.items = [...this.items.slice(-3), { ...t, id }];
    this.emit();
    return id;
  }

  dismiss(id: number) {
    this.items = this.items.filter((i) => i.id !== id);
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l(this.items);
  }
}

export const toastStore = new ToastStore();

type ToastInput = string | { title: string; description?: string; action?: ToastItem["action"]; duration?: number };
const norm = (i: ToastInput) => (typeof i === "string" ? { title: i } : i);

export const toast = Object.assign((i: ToastInput) => toastStore.push({ tone: "info", ...norm(i) }), {
  success: (i: ToastInput) => toastStore.push({ tone: "success", ...norm(i) }),
  error: (i: ToastInput) => toastStore.push({ tone: "error", ...norm(i) }),
  info: (i: ToastInput) => toastStore.push({ tone: "info", ...norm(i) }),
  dismiss: (id: number) => toastStore.dismiss(id),
});

const icons = { info: Info, success: CheckCircle2, error: AlertCircle } as const;
const iconTone = { info: "text-primary", success: "text-success", error: "text-danger" } as const;

export function Toaster() {
  const items = React.useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getSnapshot);
  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
      {items.map((t) => {
        const Icon = icons[t.tone];
        return (
          <ToastPrimitive.Root
            key={t.id}
            duration={t.duration}
            onOpenChange={(open) => {
              if (!open) toastStore.dismiss(t.id);
            }}
            data-testid={`toast-${t.tone}`}
            className="pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border bg-popover p-3.5 text-popover-foreground shadow-popover data-[state=open]:animate-slide-up data-[swipe=end]:animate-fade-out"
          >
            <Icon className={cn("mt-0.5 size-5 shrink-0", iconTone[t.tone])} aria-hidden />
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-sm font-semibold">{t.title}</ToastPrimitive.Title>
              {t.description ? <ToastPrimitive.Description className="mt-0.5 text-sm text-muted-foreground">{t.description}</ToastPrimitive.Description> : null}
              {t.action ? (
                <ToastPrimitive.Action altText={t.action.label} asChild>
                  <button type="button" onClick={t.action.onClick} className="mt-2 text-sm font-semibold text-link hover:underline">
                    {t.action.label}
                  </button>
                </ToastPrimitive.Action>
              ) : null}
            </div>
            <ToastPrimitive.Close aria-label="Dismiss" className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="fixed bottom-0 left-1/2 z-[90] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 p-4 sm:bottom-4 sm:left-4 sm:translate-x-0" />
    </ToastPrimitive.Provider>
  );
}
