/**
 * Transactional email. Three modes (MAIL_MODE):
 *   outbox  writes each message to data/outbox/*.eml (and keeps the last 200 in memory
 *           for tests); nothing is delivered
 *   smtp    nodemailer SMTP transport (Mailpit locally, any relay in production)
 *   ses     Amazon SES v2 (Floci locally, real SES on AWS)
 *
 * Sending never throws into the caller: a mail failure must not fail the request that
 * caused it. The result says whether the message was handed to a real transport.
 */
import fs from "node:fs";
import path from "node:path";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import nodemailer, { type Transporter } from "nodemailer";
import { awsClientConfig } from "../../core/aws";
import { config } from "../../core/config";
import { dataDir } from "../../core/data-dir";
import { captureError, logger } from "../../core/logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailResult {
  delivered: boolean;
  mode: "outbox" | "smtp" | "ses";
  error?: string;
}

export interface SentMail extends MailMessage {
  from: string;
  at: Date;
}

const recent: SentMail[] = [];

/** The last messages sent in this process (outbox and real modes). Tests read links from here. */
export function sentMail(): readonly SentMail[] {
  return recent;
}

export function clearSentMail(): void {
  recent.length = 0;
}

export function fromAddress(): string {
  return config.MAIL_FROM || `${config.PRODUCT_NAME} <no-reply@localhost>`;
}

let smtp: Transporter | null = null;
let ses: SESv2Client | null = null;

function smtpTransport(): Transporter {
  if (!smtp) {
    smtp = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    });
  }
  return smtp;
}

function sesClient(): SESv2Client {
  if (!ses) ses = new SESv2Client(awsClientConfig(config.SES_REGION));
  return ses;
}

async function buildMime(from: string, msg: MailMessage): Promise<Buffer> {
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const info = await composer.sendMail({ from, ...msg });
  return info.message as Buffer;
}

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  const from = fromAddress();
  const record = () => {
    recent.push({ ...msg, from, at: new Date() });
    if (recent.length > 200) recent.shift();
  };
  const mode = config.MAIL_MODE;
  try {
    if (mode === "smtp") {
      await smtpTransport().sendMail({ from, ...msg });
      record();
      return { delivered: true, mode };
    }
    if (mode === "ses") {
      const raw = await buildMime(from, msg);
      await sesClient().send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [msg.to] },
          Content: { Raw: { Data: raw } },
          ConfigurationSetName: config.SES_CONFIGURATION_SET || undefined,
        }),
      );
      record();
      return { delivered: true, mode };
    }
    const dir = dataDir("outbox");
    fs.mkdirSync(dir, { recursive: true });
    const safe = msg.to.replace(/[^a-zA-Z0-9@._-]/g, "_");
    fs.writeFileSync(path.join(dir, `${Date.now()}_${safe}.eml`), await buildMime(from, msg));
    record();
    logger.info({ to: msg.to, subject: msg.subject }, "mail written to outbox");
    return { delivered: false, mode: "outbox" };
  } catch (err) {
    captureError(err, { where: "mail", mode, subject: msg.subject });
    return { delivered: false, mode, error: err instanceof Error ? err.message : String(err) };
  }
}
