import { createVerify, generateKeyPairSync } from "node:crypto";
import { PUSH_DEFAULTS } from "@open-lms/types";
import { describe, expect, test } from "vitest";
import { assertProductionConfig, loadConfig, productionWarnings, pushEnabled, razorpayCheckoutIsStub } from "../../src/core/config";
import { checkoutReturnUrl } from "../../src/domain/safe-url";
import { fcmMessage, isDeadToken, parseServiceAccount, signAssertion } from "../../src/integrations/push/fcm";
import { emailPreferences, pushPreferences } from "../../src/presenters/user.presenter";

const WEB = "https://academy.example.org";

describe("checkout return URLs", () => {
  test("an app link with an allowed scheme, or a page on the web origin", () => {
    expect(checkoutReturnUrl("openlms://checkout/stripe", WEB, ["openlms"])).toBe("openlms://checkout/stripe");
    expect(checkoutReturnUrl("OpenLMS://checkout/stripe?x=1", WEB, ["openlms"])).toBe("OpenLMS://checkout/stripe?x=1");
    expect(checkoutReturnUrl("https://academy.example.org/checkout/done", WEB, ["openlms"])).toBe("https://academy.example.org/checkout/done");
  });

  test("anything else is an open redirect and refused", () => {
    for (const bad of [
      "https://evil.example.com/checkout",
      "http://academy.example.org/checkout",
      "https://academy.example.org.evil.example/x",
      "otherapp://checkout",
      "javascript:alert(1)",
      "data:text/html,hi",
      "openlms://checkout#frag",
      "https://user:pass@academy.example.org/x",
      "not a url",
      "",
    ]) {
      expect(checkoutReturnUrl(bad, WEB, ["openlms"]), bad).toBeNull();
    }
    expect(checkoutReturnUrl("openlms://x", WEB, [])).toBeNull();
  });
});

describe("push preferences", () => {
  test("missing keys take the push defaults (product updates off), unlike email (all on)", () => {
    expect(pushPreferences({})).toEqual(PUSH_DEFAULTS);
    expect(pushPreferences(null)).toEqual({ LEARNING: true, COMMUNITY: true, BILLING_REMINDERS: true, PRODUCT_UPDATES: false });
    expect(pushPreferences({ LEARNING: false, PRODUCT_UPDATES: true, junk: 1 })).toEqual({ LEARNING: false, COMMUNITY: true, BILLING_REMINDERS: true, PRODUCT_UPDATES: true });
    expect(emailPreferences({}).PRODUCT_UPDATES).toBe(true);
  });
});

describe("FCM HTTP v1", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = { project_id: "demo", client_email: "push@demo.example.test", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };

  test("the service account JSON needs its three fields; the placeholder is unset", () => {
    expect(parseServiceAccount(JSON.stringify(account))).toEqual(account);
    expect(parseServiceAccount("set-me")).toBeNull();
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount("{not json")).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: "x" }))).toBeNull();
  });

  test("the JWT assertion is RS256 over header.claims with the messaging scope and an hour's lifetime", () => {
    const jwt = signAssertion(account, "https://oauth2.example.test/token", 1_700_000_000);
    const [h, c, sig] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.example.test/token", iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });

  test("message shape and dead-token detection", () => {
    expect(fcmMessage({ token: "t", platform: "IOS", title: "T", body: "B", data: { url: "/x" } })).toMatchObject({ token: "t", notification: { title: "T", body: "B" }, data: { url: "/x" }, apns: { payload: { aps: { sound: "default" } } } });
    expect(isDeadToken(404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } })).toBe(true);
    expect(isDeadToken(400, { error: { status: "INVALID_ARGUMENT" } })).toBe(true);
    expect(isDeadToken(429, { error: { status: "RESOURCE_EXHAUSTED", details: [{ errorCode: "QUOTA_EXCEEDED" }] } })).toBe(false);
    expect(isDeadToken(500, null)).toBe(false);
  });
});

describe("mobile configuration", () => {
  const prod = { NODE_ENV: "test", APP_WEB_URL: "https://academy.example.org" };

  test("push is off by default; on for fcm and stub; stub is refused in production", () => {
    expect(pushEnabled(loadConfig(prod))).toBe(false);
    expect(pushEnabled(loadConfig({ ...prod, PUSH_PROVIDER: "fcm" }))).toBe(true);
    expect(assertProductionConfig(loadConfig({ ...prod, PUSH_PROVIDER: "stub" }))).toContain("PUSH_PROVIDER=stub is a test double");
  });

  test("fcm without a real service account, and a stub Razorpay checkout, are warnings", () => {
    expect(productionWarnings(loadConfig({ ...prod, PUSH_PROVIDER: "fcm", FCM_SERVICE_ACCOUNT_JSON: "set-me" })).join("\n")).toMatch(/FCM_SERVICE_ACCOUNT_JSON is not set/);
    expect(productionWarnings(loadConfig({ ...prod, PUSH_PROVIDER: "fcm", FCM_SERVICE_ACCOUNT_JSON: '{"project_id":"x"}' })).join("\n")).not.toMatch(/FCM_SERVICE_ACCOUNT_JSON/);
    const stubbed = loadConfig({ ...prod, RAZORPAY_CHECKOUT_SCRIPT_URL: "http://localhost:5119/stub/razorpay/checkout.js" });
    expect(razorpayCheckoutIsStub(stubbed)).toBe(true);
    expect(razorpayCheckoutIsStub(loadConfig(prod))).toBe(false);
    expect(productionWarnings(stubbed)).toContain("RAZORPAY_CHECKOUT_SCRIPT_URL points at a stub");
  });

  test("MOBILE_RETURN_SCHEMES defaults to openlms and is a lower-cased list", () => {
    expect(loadConfig(prod).MOBILE_RETURN_SCHEMES).toEqual(["openlms"]);
    expect(loadConfig({ ...prod, MOBILE_RETURN_SCHEMES: "OpenLMS, academy-app ," }).MOBILE_RETURN_SCHEMES).toEqual(["openlms", "academy-app"]);
  });
});
