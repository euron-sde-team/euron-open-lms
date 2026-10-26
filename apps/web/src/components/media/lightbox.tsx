"use client";

import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, IconButton } from "@open-lms/ui";
import type { Media } from "@open-lms/types";

export function Lightbox({ images, index, onIndex, onClose }: { images: Media[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const current = images[index];
  const prev = () => onIndex((index - 1 + images.length) % images.length);
  const next = () => onIndex((index + 1) % images.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!current) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent hideClose size="xl" className="h-[calc(100dvh-32px)] max-w-[calc(100vw-32px)] border-0 bg-black text-white" data-testid="lightbox">
        <DialogTitle className="sr-only">
          Image {index + 1} of {images.length}
        </DialogTitle>
        <div className="absolute right-3 top-3 z-10 flex gap-2">
          <IconButton asChild label="Download" variant="muted" className="bg-white/10 text-white hover:bg-white/20">
            <a href={current.url} download={current.fileName} target="_blank" rel="noopener noreferrer">
              <Download />
            </a>
          </IconButton>
          <IconButton label="Close" variant="muted" className="bg-white/10 text-white hover:bg-white/20" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        <div className="flex size-full items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current.url} alt={current.fileName} className="max-h-full max-w-full object-contain" />
        </div>
        {images.length > 1 ? (
          <>
            <IconButton label="Previous image" size="lg" className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/10 text-white hover:bg-white/20" onClick={prev}>
              <ChevronLeft />
            </IconButton>
            <IconButton label="Next image" size="lg" className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/10 text-white hover:bg-white/20" onClick={next}>
              <ChevronRight />
            </IconButton>
            <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs">
              {index + 1} / {images.length}
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
