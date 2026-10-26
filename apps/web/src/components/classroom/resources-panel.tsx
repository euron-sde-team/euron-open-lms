"use client";

import { Download, ExternalLink, FileText } from "lucide-react";
import type { LectureResource } from "@open-lms/types";
import { EmptyState } from "@open-lms/ui";
import { formatBytes } from "./lecture-doc";

export function ResourcesPanel({ resources }: { resources: LectureResource[] }) {
  if (!resources.length) return <EmptyState compact icon={<FileText />} title="No resources for this lesson" description="Files and links the instructor adds appear here." />;
  return (
    <ul className="max-w-[720px] divide-y divide-border border-y border-border" data-testid="classroom-resources">
      {resources.map((r) => {
        const size = formatBytes(r.sizeBytes);
        return (
          <li key={r.id}>
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              download={r.external ? undefined : (r.fileName ?? true)}
              className="flex items-center gap-3 py-3 hover:bg-muted/50"
              data-testid="classroom-resource"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium">{r.title}</span>
                <span className="block text-[12.5px] text-muted-foreground">{r.external ? new URL(r.url, "https://x").hostname : [r.fileName, size].filter(Boolean).join(" · ")}</span>
              </span>
              {r.external ? <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-label="Opens in a new tab" /> : <Download className="size-4 shrink-0 text-muted-foreground" aria-label="Download" />}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
