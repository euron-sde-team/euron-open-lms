# ADR 0018: Gap-free invoice and credit note numbers

## Status

Accepted.

## Context

Many tax authorities expect invoices to be numbered in an unbroken sequence per series.
Numbers taken from a database sequence have gaps (a rolled-back transaction burns its
value). Numbers assigned after commit, by a job, can be issued twice or out of order, and an
invoice that exists without a number is not an invoice.

## Decision

- Two series per calendar year (UTC): `INV-<yyyy>` for invoices and `CN-<yyyy>` for credit
  notes, numbered `INV-2026-000042`.
- `invoice_sequences (series, next)` holds the counter. `invoiceRepo.nextNumber` runs
  `INSERT ... ON CONFLICT (series) DO UPDATE SET next = next + 1 RETURNING next - 1` inside
  the transaction that inserts the invoice
  ([`repositories/invoice.repository.ts`](../../../apps/api/src/repositories/invoice.repository.ts)).
  The row lock serialises issuers until commit; a rollback releases the number.
- Invoices are issued in the transaction that makes them true: an order turning PAID, a
  renewal order, a refund settling (credit note). Partial unique indexes allow one invoice
  per order and one credit note per refund.
- Seller, buyer, lines and tax are frozen on the row. The PDF is rendered after commit by
  `invoices.render` and stored privately.

## Consequences

Positive:

- Strictly sequential, gap-free numbers per series, no duplicates.
- Editing the academy's legal details never rewrites an old invoice.

Trade-offs:

- Every fulfilment in a year waits on one counter row for the rest of its transaction;
  fine at LMS volumes, a contention point at very high ones.
- The PDF can lag the invoice row (`409 INVOICE_RENDERING` until the job runs).

## Alternatives considered

- **A PostgreSQL sequence.** Gaps on rollback.
- **Numbering in the render job.** Duplicates and reordering under retries.
