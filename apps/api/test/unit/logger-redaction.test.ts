import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { REDACT } from "../../src/core/logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(String(chunk)));
      cb();
    },
  });
  return { log: pino({ redact: REDACT }, stream), lines };
}

describe("logger redaction", () => {
  test("masks secrets at the top level and up to three levels deep, keeps everything else", () => {
    const { log, lines } = capture();
    log.info(
      {
        password: "top",
        req: { body: { password: "in-body", login: "alice", totp: "123456" }, headers: { authorization: "Bearer x", cookie: "lms_refresh=y", host: "api" } },
        job: { data: { user: { token: "deep", id: "u1" } } },
        err: { config: { data: { refreshToken: "nested" } } },
      },
      "hello",
    );
    const line = lines[0] as any;
    expect(line.password).toBe("[redacted]");
    expect(line.req.body).toEqual({ password: "[redacted]", login: "alice", totp: "[redacted]" });
    expect(line.req.headers).toMatchObject({ authorization: "[redacted]", cookie: "[redacted]", host: "api" });
    expect(line.job.data.user).toEqual({ token: "[redacted]", id: "u1" });
    expect(line.err.config.data.refreshToken).toBe("[redacted]");
    expect(JSON.stringify(line)).not.toMatch(/in-body|deep|nested|Bearer x|lms_refresh=y/);
  });
});
