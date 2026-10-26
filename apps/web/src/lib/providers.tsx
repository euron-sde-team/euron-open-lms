"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isApiError } from "@open-lms/api-client";
import { Toaster, TooltipProvider, toast } from "@open-lms/ui";
import { AuthProvider } from "./auth";
import { errorMessage, isQuietError } from "./errors";
import { useTheme } from "./stores/theme";

export function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Background refetch failures of data already on screen: tell the person once.
        if (query.state.data !== undefined && !isQuietError(error) && query.meta?.silent !== true) {
          toast.error({ title: errorMessage(error) });
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.meta?.silent === true) return;
        if (isApiError(error) && error.status === 401) return;
        toast.error({ title: errorMessage(error) });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Media URLs inside responses are signed and expire; do not keep stale data around for long.
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => {
          if (isApiError(error) && error.status > 0 && error.status < 500) return false;
          return count < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

function ThemeHydrator() {
  const hydrate = useTheme((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={400}>
        <AuthProvider>{children}</AuthProvider>
        <ThemeHydrator />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: { silent?: boolean };
    mutationMeta: { silent?: boolean };
  }
}
