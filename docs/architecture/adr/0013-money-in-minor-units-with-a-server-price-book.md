# ADR 0013: Money in minor units, priced from a server price book

## Status

Accepted.

## Context

The system this one replaces stored prices as floats and took the amount and the currency
from the client at checkout. Floats round differently in JavaScript, PostgreSQL and the
gateways; a client-supplied amount is a discount anyone can give themselves. Academies sell
in more than one currency (USD through Stripe and INR through Razorpay is common), with
coupons and tax on top, and invoices must add up to the cent.

## Decision

- Every amount is an integer count of the currency's minor unit (`bigint`) next to an ISO
  4217 code. Currencies with other exponents (JPY 0, KWD 3, ...) are handled by
  `minorExponent` ([`domain/pricing.ts`](../../../apps/api/src/domain/pricing.ts)).
- The **price book** (`prices`) holds one active price per item, currency and interval.
  There is no conversion between currencies: each enabled currency is priced explicitly.
- The client sends only what it buys, the currency (one of `settings.currencies`) and an
  optional coupon code. The server prices it: subtotal from the price book, then the coupon
  (spread over lines by largest remainder), then tax per line (EXCLUSIVE added, INCLUSIVE
  carved out, rounded half up per line).
- The order freezes subtotal, discount, tax and total, the tax terms and the billing
  details; the database checks `total = subtotal - discount + (EXCLUSIVE ? tax : 0)`.
- The gateway charges exactly the order total: Stripe receives each line at its final
  amount, Razorpay the total. The captured amount must equal it
  ([ADR 0014](0014-one-fulfilment-path.md)).
- The currency picks the gateway on the server (`routeCurrency`).
- Reports never sum across currencies.

## Consequences

Positive:

- No rounding drift; invoices, gateway charges and order rows agree exactly.
- No client-chosen price.

Trade-offs:

- Staff maintain a price per currency.
- `bigint` is parsed as a JavaScript number, exact below 2^53.

## Alternatives considered

- **Decimal columns.** Exact, but every layer (JSON, the gateways) speaks minor units anyway.
- **One base currency with FX conversion.** Prices would move with exchange rates and the
  invoice would need the rate; explicit prices are simpler to reason about.
