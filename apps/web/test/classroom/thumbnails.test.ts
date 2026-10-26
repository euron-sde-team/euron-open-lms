import { describe, expect, it } from "vitest";
import { cueAt, parseThumbnailVtt } from "@/components/player/thumbnails";

const VTT = `WEBVTT

00:00:00.000 --> 00:00:05.000
sprite-0.jpg#xywh=0,0,160,90

00:00:05.000 --> 00:00:10.000
sprite-0.jpg#xywh=160,0,160,90
`;

describe("thumbnail track", () => {
  it("parses sprite cues and resolves them against the track URL", () => {
    const cues = parseThumbnailVtt(VTT, "https://cdn.example.org/v/1/thumbs.vtt?sig=abc");
    expect(cues).toHaveLength(2);
    expect(cues[1]).toMatchObject({ start: 5, end: 10, url: "https://cdn.example.org/v/1/sprite-0.jpg", rect: { x: 160, y: 0, w: 160, h: 90 } });
    expect(cueAt(cues, 7)?.rect?.x).toBe(160);
    expect(cueAt(cues, 11)).toBeNull();
  });
});
