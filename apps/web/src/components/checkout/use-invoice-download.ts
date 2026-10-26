"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "@open-lms/ui";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";

/** Download an invoice or credit note PDF; a 409 INVOICE_RENDERING is a quiet "try again shortly". */
export function useInvoiceDownload() {
  return useMutation({
    mutationFn: async (inv: { id: string; number: string }) => {
      const blob = await api().billing.invoicePdf(inv.id);
      saveBlob(blob, `${inv.number}.pdf`);
    },
    meta: { silent: true },
    onError: (e) => toast.info({ title: errorMessage(e) }),
  });
}
