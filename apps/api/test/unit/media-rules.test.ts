import { describe, expect, test } from "vitest";
import { checkDeclared, cleanFileName, isoBmffDuration, looksLikeMarkup, sniffMatches, storageKeyFor, wavDuration } from "../../src/domain/media-rules";

const MB = 1024 * 1024;
const pad = (head: number[] | Buffer, total = 64) => Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, total - Buffer.from(head).length))]);
const ftyp = (brand: string) => pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftyp" + brand, "latin1")]));

const SAMPLES: Record<string, Buffer> = {
  "image/jpeg": pad([0xff, 0xd8, 0xff, 0xe0]),
  "image/png": pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/gif": pad(Buffer.from("GIF89a")),
  "image/webp": pad(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])),
  "image/heic": ftyp("heic"),
  "video/mp4": ftyp("isom"),
  "video/quicktime": ftyp("qt  "),
  "video/webm": pad(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("\x42\x82\x84webm", "latin1")])),
  "audio/mpeg": pad(Buffer.from("ID3\x04")),
  "audio/mp4": ftyp("M4A "),
  "audio/ogg": pad(Buffer.from("OggS")),
  "audio/wav": pad(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt ")])),
  "application/pdf": pad(Buffer.from("%PDF-1.7\n")),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": pad([0x50, 0x4b, 0x03, 0x04]),
  "text/csv": Buffer.from("a,b,c\n1,2,3\n"),
  "text/plain": Buffer.from("hello there\n"),
};

describe("sniffMatches", () => {
  for (const [mime, buf] of Object.entries(SAMPLES)) {
    test(`accepts real ${mime}`, () => expect(sniffMatches(mime, buf)).toBe(true));
  }

  test("audio/mp4 accepts only audio brands (M4A, M4B, M4P): an MP4 video or HEIC is not audio", () => {
    for (const brand of ["M4A ", "M4B ", "M4P "]) expect(sniffMatches("audio/mp4", ftyp(brand))).toBe(true);
    for (const brand of ["isom", "mp42", "avc1", "heic", "qt  "]) {
      expect(sniffMatches("audio/mp4", ftyp(brand))).toBe(false);
      expect(sniffMatches("audio/x-m4a", ftyp(brand))).toBe(false);
    }
  });

  test("a PNG declared as JPEG is refused, and vice versa", () => {
    expect(sniffMatches("image/jpeg", SAMPLES["image/png"]!)).toBe(false);
    expect(sniffMatches("image/png", SAMPLES["image/jpeg"]!)).toBe(false);
  });

  test("HTML or SVG bytes never pass as an image or text", () => {
    const html = Buffer.from("<!doctype html><script>alert(1)</script>");
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
    for (const mime of ["image/jpeg", "image/png", "text/plain", "text/csv", "application/pdf"]) {
      expect(sniffMatches(mime, html)).toBe(false);
      expect(sniffMatches(mime, svg)).toBe(false);
    }
    expect(looksLikeMarkup(Buffer.from("﻿  <svg onload=x>"))).toBe(true);
  });

  test("binary is not plain text", () => {
    expect(sniffMatches("text/plain", Buffer.from([0x68, 0x00, 0x69]))).toBe(false);
  });

  test("HEIC is not accepted as MP4, nor MP4 as HEIC", () => {
    expect(sniffMatches("video/mp4", SAMPLES["image/heic"]!)).toBe(false);
    expect(sniffMatches("image/heic", SAMPLES["video/mp4"]!)).toBe(false);
  });

  test("an empty file or an unknown type never matches", () => {
    expect(sniffMatches("image/png", Buffer.alloc(0))).toBe(false);
    expect(sniffMatches("application/x-msdownload", Buffer.from("MZ"))).toBe(false);
  });
});

describe("checkDeclared", () => {
  const ok = (over: Partial<Parameters<typeof checkDeclared>[0]> = {}) => checkDeclared({ purpose: "LECTURE_RESOURCE", fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 1000, ...over });

  test("an allowed type with a matching extension passes and gets a canonical extension", () => {
    expect(ok()).toEqual({ ok: true, kind: "IMAGE", ext: "jpg", mimeType: "image/jpeg" });
    expect(ok({ fileName: "Holiday.JPEG", mimeType: "Image/JPEG; charset=binary" })).toMatchObject({ ok: true, ext: "jpg" });
  });

  test("SVG and HTML are refused by type and by extension", () => {
    expect(ok({ fileName: "logo.svg", mimeType: "image/svg+xml" })).toMatchObject({ ok: false, code: "MEDIA_TYPE_NOT_ALLOWED" });
    expect(ok({ fileName: "page.html", mimeType: "text/html" })).toMatchObject({ ok: false, code: "MEDIA_TYPE_NOT_ALLOWED" });
    expect(ok({ fileName: "page.html", mimeType: "text/plain" })).toMatchObject({ ok: false, code: "MEDIA_TYPE_NOT_ALLOWED" });
  });

  test("a spoofed extension is refused", () => {
    expect(ok({ fileName: "invoice.pdf", mimeType: "image/png" })).toMatchObject({ ok: false, code: "MEDIA_EXTENSION_MISMATCH" });
    expect(ok({ fileName: "noextension", mimeType: "image/png" })).toMatchObject({ ok: false, code: "MEDIA_EXTENSION_MISMATCH" });
    expect(ok({ fileName: "setup.exe", mimeType: "application/pdf" })).toMatchObject({ ok: false });
  });

  test("per-kind size limits", () => {
    expect(ok({ sizeBytes: 15 * MB })).toMatchObject({ ok: true });
    expect(ok({ sizeBytes: 15 * MB + 1 })).toMatchObject({ ok: false, code: "MEDIA_TOO_LARGE" });
    expect(ok({ purpose: "SUBMISSION", fileName: "a.mp4", mimeType: "video/mp4", sizeBytes: 200 * MB })).toMatchObject({ ok: true });
    expect(ok({ purpose: "SUBMISSION", fileName: "a.mp4", mimeType: "video/mp4", sizeBytes: 200 * MB + 1 })).toMatchObject({ ok: false, code: "MEDIA_TOO_LARGE" });
    expect(ok({ fileName: "a.mp3", mimeType: "audio/mpeg", sizeBytes: 50 * MB + 1 })).toMatchObject({ ok: false, code: "MEDIA_TOO_LARGE" });
    expect(ok({ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 25 * MB + 1 })).toMatchObject({ ok: false, code: "MEDIA_TOO_LARGE" });
    expect(ok({ sizeBytes: 0 })).toMatchObject({ ok: false, code: "MEDIA_EMPTY" });
  });

  test("avatars, course covers and branding must be an image", () => {
    for (const purpose of ["AVATAR", "COURSE_COVER", "BRANDING"] as const) {
      expect(ok({ purpose, fileName: "a.pdf", mimeType: "application/pdf" })).toMatchObject({ ok: false, code: "MEDIA_PURPOSE_MISMATCH" });
      expect(ok({ purpose })).toMatchObject({ ok: true });
    }
  });

  test("a PDF lecture is a PDF, never an image or a document", () => {
    expect(ok({ purpose: "LECTURE_PDF", fileName: "notes.pdf", mimeType: "application/pdf" })).toMatchObject({ ok: true, kind: "PDF" });
    expect(ok({ purpose: "LECTURE_PDF" })).toMatchObject({ ok: false, code: "MEDIA_PURPOSE_MISMATCH" });
    expect(ok({ purpose: "LECTURE_PDF", fileName: "notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toMatchObject({ ok: false, code: "MEDIA_PURPOSE_MISMATCH" });
  });

  test("resources take documents, archives and audio but no video; submissions also take video", () => {
    expect(ok({ fileName: "data.zip", mimeType: "application/zip" })).toMatchObject({ ok: true, kind: "ARCHIVE" });
    expect(ok({ fileName: "talk.m4a", mimeType: "audio/mp4" })).toMatchObject({ ok: true, kind: "AUDIO" });
    expect(ok({ fileName: "a.mp4", mimeType: "video/mp4" })).toMatchObject({ ok: false, code: "MEDIA_PURPOSE_MISMATCH" });
    expect(ok({ purpose: "SUBMISSION", fileName: "a.mp4", mimeType: "video/mp4" })).toMatchObject({ ok: true, kind: "VIDEO" });
    expect(ok({ purpose: "SUBMISSION", fileName: "sheet.csv", mimeType: "text/csv" })).toMatchObject({ ok: true, kind: "DOCUMENT" });
  });
});

describe("keys and names", () => {
  test("storage keys never contain the client file name", () => {
    expect(storageKeyFor("COURSE_COVER", "01JABCDEFGHJKMNPQRSTVWXYZ0", "png", new Date("2026-03-04T00:00:00Z"))).toBe("media/course_cover/2026/03/01JABCDEFGHJKMNPQRSTVWXYZ0.png");
  });
  test("display names are stripped of paths and control characters", () => {
    expect(cleanFileName("../../etc/pass\u0000wd\".txt")).toBe("pass_wd_.txt");
  });
});

describe("durations", () => {
  test("mp4 mvhd version 0", () => {
    const mvhd = Buffer.alloc(8 + 100);
    mvhd.writeUInt32BE(mvhd.length, 0);
    mvhd.write("mvhd", 4, "latin1");
    mvhd.writeUInt32BE(1000, 8 + 12);
    mvhd.writeUInt32BE(42_500, 8 + 16);
    const moov = Buffer.concat([Buffer.alloc(8), mvhd]);
    moov.writeUInt32BE(moov.length, 0);
    moov.write("moov", 4, "latin1");
    const file = Buffer.concat([ftyp("isom").subarray(0, 24), moov]);
    file.writeUInt32BE(24, 0);
    expect(isoBmffDuration(file)).toBe(43);
  });
  test("wav", () => {
    const b = Buffer.alloc(44);
    b.write("RIFF", 0, "latin1");
    b.write("WAVE", 8, "latin1");
    b.write("fmt ", 12, "latin1");
    b.writeUInt32LE(16, 16);
    b.writeUInt32LE(16_000, 28);
    b.write("data", 36, "latin1");
    b.writeUInt32LE(160_000, 40);
    expect(wavDuration(b)).toBe(10);
  });
});
