import { describe, expect, it } from "vitest";
import { csvCell } from "../../src/services/admin-commerce.service";
import { REDACTED, redact, redactedJson } from "../../src/services/payments/redact";

describe("webhook payload redaction", () => {
  it("removes card, contact, address and UPI details at any depth and keeps the rest", () => {
    const out = redact({
      id: "evt_1",
      data: {
        object: {
          id: "pay_1",
          amount: 49900,
          email: "ada@example.test",
          contact: "+1 555 0100",
          vpa: "ada@okbank",
          card: { last4: "4242", network: "Visa" },
          customer_details: { name: "Ada", address: { line1: "1 Main St" } },
          notes: { order_id: "ORD", note: "reach me at ada@example.test" },
          refunds: [{ id: "re_1", receipt_email: "ada@example.test" }],
        },
      },
    }) as any;
    expect(out.id).toBe("evt_1");
    expect(out.data.object).toMatchObject({ id: "pay_1", amount: 49900, email: REDACTED, contact: REDACTED, vpa: REDACTED, card: REDACTED, customer_details: REDACTED });
    expect(out.data.object.notes).toEqual({ order_id: "ORD", note: REDACTED });
    expect(out.data.object.refunds[0]).toEqual({ id: "re_1", receipt_email: REDACTED });
  });

  it("keeps explicit nulls, and strips NUL characters PostgreSQL JSON rejects", () => {
    expect(redact({ email: null })).toEqual({ email: null });
    expect(redactedJson({ note: "a\u0000b" })).toBe('{"note":"ab"}');
  });
});

describe("CSV cells", () => {
  it("quotes separators and neutralises spreadsheet formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
  });
});
