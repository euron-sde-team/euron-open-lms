"use client";

import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Classroom, ItemContent, ProgressResult } from "@open-lms/types";
import { toast } from "@open-lms/ui";
import { applyProgress, finishesCourse } from "@/lib/classroom/curriculum";
import { qk } from "@/lib/query-keys";
import { useClassroom } from "./classroom-context";

/**
 * Applies a ProgressResult everywhere it shows: the curriculum rings and the course line
 * (cache surgery first, so it is instant), a single "Completed" toast per item, and the
 * completion moment when this result finished the course.
 */
export function useApplyProgress() {
  const qc = useQueryClient();
  const { slug, setFinished } = useClassroom();
  const toasted = useRef(new Set<string>());

  return useCallback(
    (itemId: string, result: ProgressResult) => {
      const before = qc.getQueryData<Classroom>(qk.classroom(slug));
      qc.setQueryData<Classroom>(qk.classroom(slug), (c) => (c ? applyProgress(c, itemId, result) : c));
      qc.setQueryData<ItemContent>(qk.item(itemId), (it) => (it ? ({ ...it, progress: result.progress } as ItemContent) : it));
      if (result.justCompleted && !toasted.current.has(itemId)) {
        toasted.current.add(itemId);
        toast.success({ title: "Completed", duration: 2500 });
        void qc.invalidateQueries({ queryKey: qk.classroom(slug) });
        void qc.invalidateQueries({ queryKey: qk.myLearningAll });
        void qc.invalidateQueries({ queryKey: qk.mySummary });
      }
      if (finishesCourse(before, result)) {
        setFinished({ serial: result.certificate?.serial ?? null });
        void qc.invalidateQueries({ queryKey: qk.myCertificates });
      }
    },
    [qc, slug, setFinished],
  );
}
