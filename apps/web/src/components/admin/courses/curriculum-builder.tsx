"use client";

import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ClipboardCheck, Eye, EyeOff, FileText, FileType2, GripVertical, ListChecks, MoreHorizontal, Pencil, Plus, Trash2, Video } from "lucide-react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, IconButton, Input, cn, toast } from "@open-lms/ui";
import type { AdminCourse, AdminItemSummary, AdminSection, ItemKind, LectureKind } from "@open-lms/types";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/duration";
import { errorMessage } from "@/lib/errors";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { VideoStatusText, courseKey, itemKindLabel, itemKey, useSetCourse, type CourseRights } from "./course-bits";
import {
  curriculumReducer,
  dropTarget,
  findItem,
  initialCurriculum,
  itemDndId,
  locateItem,
  moveItem,
  parseDndId,
  sectionDndId,
  totalDuration,
  zoneDndId,
} from "./curriculum-model";
import { ItemEditorSheet } from "./item-editor";

export const NEW_ITEM_KINDS: { key: string; label: string; kind: ItemKind; lectureKind?: LectureKind; title: string; icon: ReactNode }[] = [
  { key: "video", label: "Video lecture", kind: "LECTURE", lectureKind: "VIDEO", title: "New video lecture", icon: <Video /> },
  { key: "article", label: "Article", kind: "LECTURE", lectureKind: "ARTICLE", title: "New article", icon: <FileText /> },
  { key: "pdf", label: "PDF", kind: "LECTURE", lectureKind: "PDF", title: "New PDF", icon: <FileType2 /> },
  { key: "quiz", label: "Quiz", kind: "QUIZ", title: "New quiz", icon: <ListChecks /> },
  { key: "assignment", label: "Assignment", kind: "ASSIGNMENT", title: "New assignment", icon: <ClipboardCheck /> },
];

export function ItemIcon({ item, className }: { item: Pick<AdminItemSummary, "kind" | "lectureKind">; className?: string }) {
  const cls = cn("size-4 shrink-0 text-muted-foreground", className);
  if (item.kind === "QUIZ") return <ListChecks className={cls} aria-hidden />;
  if (item.kind === "ASSIGNMENT") return <ClipboardCheck className={cls} aria-hidden />;
  if (item.lectureKind === "ARTICLE") return <FileText className={cls} aria-hidden />;
  if (item.lectureKind === "PDF") return <FileType2 className={cls} aria-hidden />;
  return <Video className={cls} aria-hidden />;
}

/** Items first (the pointer's own row wins over the list around it); sections only for section drags. */
const collision: CollisionDetection = (args) => {
  const type = args.active.data.current?.type;
  const ids = (re: RegExp) => args.droppableContainers.filter((c) => re.test(String(c.id)));
  if (type === "section") return closestCenter({ ...args, droppableContainers: ids(/^s:/) });
  const targets = ids(/^[iz]:/);
  if (args.pointerCoordinates) {
    const within = pointerWithin({ ...args, droppableContainers: targets });
    if (within.length) {
      const item = within.find((c) => String(c.id).startsWith("i:"));
      return item ? [item] : within;
    }
  } else {
    // Keyboard: step between items, and into empty sections through their drop zone.
    const empty = targets.filter((c) => String(c.id).startsWith("i:") || c.data.current?.empty);
    return closestCenter({ ...args, droppableContainers: empty });
  }
  return closestCenter({ ...args, droppableContainers: targets });
};

export function CurriculumBuilder({ course, rights, openItemId, onOpenItem }: { course: AdminCourse; rights: CourseRights; openItemId: string | null; onOpenItem: (id: string | null) => void }) {
  const qc = useQueryClient();
  const setCourse = useSetCourse(course.id);
  const [state, dispatch] = useReducer(curriculumReducer, course.sections, initialCurriculum);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [active, setActive] = useState<{ type: "section" | "item"; id: string } | null>(null);
  const [newSection, setNewSection] = useState("");
  const editable = rights.canEdit;

  useEffect(() => dispatch({ type: "sync", sections: course.sections }), [course.sections]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const commit = (sections: AdminSection[]) => {
    dispatch({ type: "commit", sections });
    setCourse((c) => ({ ...c, sections }));
  };
  const fail = (e: unknown) => {
    dispatch({ type: "rollback" });
    toast.error({ title: `The move was not saved. ${errorMessage(e)}` });
    void qc.invalidateQueries({ queryKey: courseKey(course.id) });
  };
  const moveSectionM = useMutation({
    mutationFn: (v: { sectionId: string; toIndex: number }) => api().authoring.sections.move(course.id, v.sectionId, v.toIndex),
    meta: { silent: true },
    onSuccess: commit,
    onError: fail,
  });
  const moveItemM = useMutation({
    mutationFn: (v: { itemId: string; sectionId: string; toIndex: number }) => api().authoring.items.move(course.id, v.itemId, v.sectionId, v.toIndex),
    meta: { silent: true },
    onSuccess: commit,
    onError: fail,
  });

  const titleOf = (raw: string | number | undefined | null): string => {
    const ref = raw == null ? null : parseDndId(raw);
    if (!ref) return "";
    const s = stateRef.current.sections;
    if (ref.type === "item") return findItem(s, ref.id)?.title ?? "item";
    return s.find((x) => x.id === ref.id)?.title ?? "section";
  };
  const placeOf = (raw: string | number): string => {
    const ref = parseDndId(raw);
    const s = stateRef.current.sections;
    if (!ref) return "";
    if (ref.type === "item") {
      const at = locateItem(s, ref.id);
      const sec = s.find((x) => x.id === at?.sectionId);
      return at && sec ? `position ${at.index + 1} of ${sec.items.length} in ${sec.title}` : "";
    }
    const i = s.findIndex((x) => x.id === ref.id);
    return `section position ${i + 1} of ${s.length}`;
  };
  // The drop is announced before onDragEnd's move reaches the state, so work out where it lands
  // the same way onDragEnd does instead of reading the position it is leaving.
  const placeAfterDrop = (activeId: string | number, overId: string | number): string => {
    const a = parseDndId(activeId);
    const o = parseDndId(overId);
    const s = stateRef.current.sections;
    if (a?.type === "item" && o) {
      const target = dropTarget(s, a.id, o);
      const moved = target ? moveItem(s, a.id, target.sectionId, target.index) : s;
      const at = locateItem(moved, a.id);
      const sec = moved.find((x) => x.id === at?.sectionId);
      return at && sec ? `position ${at.index + 1} of ${sec.items.length} in ${sec.title}` : "";
    }
    if (a?.type === "section" && o?.type === "section") {
      const i = s.findIndex((x) => x.id === o.id);
      if (i !== -1) return `section position ${i + 1} of ${s.length}`;
    }
    return placeOf(activeId);
  };
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${titleOf(a.id)}, ${placeOf(a.id)}. Use the arrow keys to move, space to drop, escape to cancel.`,
    onDragOver: ({ active: a, over }) => (over ? `${titleOf(a.id)} is now over ${titleOf(over.id)}.` : `${titleOf(a.id)} is not over a drop place.`),
    onDragEnd: ({ active: a, over }) => (over ? `Dropped ${titleOf(a.id)}, ${placeAfterDrop(a.id, over.id)}.` : `${titleOf(a.id)} was dropped back where it was.`),
    onDragCancel: ({ active: a }) => `Moving ${titleOf(a.id)} was cancelled. It is back where it started.`,
  };

  const onDragStart = (e: DragStartEvent) => {
    const ref = parseDndId(e.active.id);
    if (!ref || ref.type === "zone") return;
    setActive({ type: ref.type, id: ref.id });
    dispatch({ type: "begin" });
  };
  const onDragOver = (e: DragOverEvent) => {
    const a = parseDndId(e.active.id);
    const o = e.over ? parseDndId(e.over.id) : null;
    if (!a || a.type !== "item" || !o) return;
    const s = stateRef.current.sections;
    const from = locateItem(s, a.id);
    const to = dropTarget(s, a.id, o);
    // Within a section the sortable strategy animates; only cross-section moves change the lists live.
    if (from && to && to.sectionId !== from.sectionId) dispatch({ type: "preview-item", itemId: a.id, sectionId: to.sectionId, index: to.index });
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const a = parseDndId(e.active.id);
    const o = e.over ? parseDndId(e.over.id) : null;
    const { sections, snapshot } = stateRef.current;
    const before = snapshot ?? sections;
    if (!a || !o) return dispatch({ type: "cancel" });
    if (a.type === "section") {
      const toIndex = o.type === "section" ? sections.findIndex((s) => s.id === o.id) : -1;
      const from = before.findIndex((s) => s.id === a.id);
      if (toIndex === -1 || toIndex === from) return dispatch({ type: "cancel" });
      dispatch({ type: "move-section", sectionId: a.id, index: toIndex });
      return moveSectionM.mutate({ sectionId: a.id, toIndex });
    }
    if (a.type !== "item") return dispatch({ type: "cancel" });
    const target = dropTarget(sections, a.id, o);
    if (!target) return dispatch({ type: "cancel" });
    const final = locateItem(moveItem(sections, a.id, target.sectionId, target.index), a.id);
    const original = locateItem(before, a.id);
    if (!final || (original && original.sectionId === final.sectionId && original.index === final.index)) return dispatch({ type: "cancel" });
    dispatch({ type: "move-item", itemId: a.id, sectionId: final.sectionId, index: final.index });
    moveItemM.mutate({ itemId: a.id, sectionId: final.sectionId, toIndex: final.index });
  };

  const addSection = useMutation({
    mutationFn: (title: string) => api().authoring.sections.create(course.id, title),
    onSuccess: (section) => {
      setCourse((c) => ({ ...c, sections: [...c.sections, section] }));
      setNewSection("");
      void qc.invalidateQueries({ queryKey: courseKey(course.id) });
    },
  });

  const sections = state.sections;
  const activeItem = active?.type === "item" ? findItem(sections, active.id) : null;
  const activeSection = active?.type === "section" ? sections.find((s) => s.id === active.id) : null;
  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div data-testid="curriculum-builder">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <p className="text-[13.5px] text-muted-foreground">
          {sections.length} {sections.length === 1 ? "section" : "sections"} · {itemCount} {itemCount === 1 ? "item" : "items"} · {formatDuration(totalDuration(sections))}
          {editable ? <span className="hidden sm:inline"> · Drag the handles to reorder, or focus one and use space and the arrow keys.</span> : null}
        </p>
        {state.pending > 0 ? (
          <p className="text-[12.5px] text-subtle-foreground" aria-live="polite">
            Saving order
          </p>
        ) : null}
      </div>

      {sections.length === 0 ? (
        <EmptyState compact icon={<ListChecks />} title="No sections yet" description="A course is sections of lectures, quizzes and assignments. Start with the first section." />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setActive(null);
            dispatch({ type: "cancel" });
          }}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: "To pick up a section or an item, press space or enter. Use the arrow keys to move it, space or enter to drop it, and escape to cancel." },
          }}
        >
          <SortableContext items={sections.map((s) => sectionDndId(s.id))} strategy={verticalListSortingStrategy}>
            <ol className="space-y-6" aria-label="Sections">
              {sections.map((s, i) => (
                <SectionBlock key={s.id} course={course} section={s} index={i} editable={editable} openItemId={openItemId} onOpenItem={onOpenItem} />
              ))}
            </ol>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeItem ? (
              <div className="flex items-center gap-3 rounded-md bg-card px-3 py-2.5 text-sm shadow-popover">
                <GripVertical className="size-4 text-subtle-foreground" aria-hidden />
                <ItemIcon item={activeItem} />
                <span className="truncate font-medium">{activeItem.title}</span>
              </div>
            ) : activeSection ? (
              <div className="rounded-md bg-card px-3 py-3 shadow-popover">
                <p className="font-display text-[16px] font-semibold">{activeSection.title}</p>
                <p className="text-[12.5px] text-muted-foreground">{activeSection.items.length} items</p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {editable ? (
        <form
          className="mt-6 flex max-w-lg gap-2 border-t border-border pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            const t = newSection.trim();
            if (t) addSection.mutate(t);
          }}
        >
          <Input aria-label="New section title" placeholder={sections.length ? "Next section title" : "First section title, like Getting started"} value={newSection} maxLength={120} onChange={(e) => setNewSection(e.target.value)} data-testid="section-new-title" />
          <Button type="submit" variant="outline" disabled={!newSection.trim()} loading={addSection.isPending} data-testid="section-add">
            <Plus /> Add section
          </Button>
        </form>
      ) : null}

      <ItemEditorSheet course={course} rights={rights} itemId={openItemId} onClose={() => onOpenItem(null)} />
    </div>
  );
}

// ─── Sections ───────────────────────────────────────────────────────────────

function SectionBlock({ course, section, index, editable, openItemId, onOpenItem }: { course: AdminCourse; section: AdminSection; index: number; editable: boolean; openItemId: string | null; onOpenItem: (id: string) => void }) {
  const qc = useQueryClient();
  const setCourse = useSetCourse(course.id);
  const sortable = useSortable({ id: sectionDndId(section.id), data: { type: "section" }, disabled: !editable });
  const zone = useDroppable({ id: zoneDndId(section.id), data: { type: "zone", empty: section.items.length === 0 }, disabled: !editable });
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rename = useMutation({
    mutationFn: (title: string) => api().authoring.sections.rename(course.id, section.id, title),
    onMutate: (title) => setCourse((c) => ({ ...c, sections: c.sections.map((s) => (s.id === section.id ? { ...s, title } : s)) })),
    onError: () => void qc.invalidateQueries({ queryKey: courseKey(course.id) }),
  });
  const remove = useMutation({
    mutationFn: () => api().authoring.sections.remove(course.id, section.id),
    onSuccess: () => {
      setCourse((c) => ({ ...c, sections: c.sections.filter((s) => s.id !== section.id) }));
      void qc.invalidateQueries({ queryKey: courseKey(course.id) });
      toast.success({ title: `Deleted "${section.title}".` });
    },
  });
  const addItem = useMutation({
    mutationFn: (k: (typeof NEW_ITEM_KINDS)[number]) => api().authoring.items.create(course.id, { sectionId: section.id, kind: k.kind, title: k.title, lectureKind: k.lectureKind }),
    onSuccess: (item) => {
      qc.setQueryData(itemKey(course.id, item.id), item);
      void qc.invalidateQueries({ queryKey: courseKey(course.id) });
      onOpenItem(item.id);
    },
  });

  const duration = section.items.reduce((n, i) => n + i.durationSeconds, 0);
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn("list-none", sortable.isDragging && "opacity-40")}
      data-testid={`section-${section.id}`}
      aria-label={`Section ${index + 1}: ${section.title}`}
    >
      <div className="flex items-center gap-2 border-b border-border pb-2">
        {editable ? (
          <button
            type="button"
            className="inline-flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-subtle-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
            aria-label={`Move section ${section.title}`}
            {...sortable.attributes}
            {...sortable.listeners}
            data-testid="section-handle"
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          {renaming ? (
            <InlineRename
              label="Section title"
              value={section.title}
              maxLength={120}
              onDone={(t) => {
                setRenaming(false);
                if (t && t !== section.title) rename.mutate(t);
              }}
            />
          ) : (
            <h3 className="truncate font-display text-[17px] font-semibold tracking-[-0.01em]">
              <span className="mr-2 text-subtle-foreground tabular-nums">{index + 1}</span>
              {section.title}
            </h3>
          )}
          <p className="text-[12.5px] text-muted-foreground">
            {section.items.length} {section.items.length === 1 ? "item" : "items"}
            {duration ? ` · ${formatDuration(duration)}` : ""}
          </p>
        </div>
        {editable ? (
          <>
            <AddItemMenu onPick={(k) => addItem.mutate(k)} busy={addItem.isPending} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`More for ${section.title}`} size="sm" data-testid="section-menu">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRenaming(true)} data-testid="section-rename">
                  <Pencil /> Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)} data-testid="section-delete">
                  <Trash2 /> Delete section
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>

      <SortableContext items={section.items.map((i) => itemDndId(i.id))} strategy={verticalListSortingStrategy}>
        <ul ref={zone.setNodeRef} className={cn("min-h-12 divide-y divide-border pb-2 transition-colors", zone.isOver && section.items.length === 0 && "bg-primary/10")} aria-label={`Items in ${section.title}`}>
          {section.items.map((item) => (
            <ItemRow key={item.id} course={course} item={item} editable={editable} selected={openItemId === item.id} onOpen={() => onOpenItem(item.id)} />
          ))}
          {section.items.length === 0 ? <li className="py-3 text-[13px] text-subtle-foreground">{editable ? "Empty. Add an item, or drag one here." : "Empty."}</li> : null}
        </ul>
      </SortableContext>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete "${section.title}"?`}
        description={section.items.length ? `Its ${section.items.length} items are deleted with it, including any learner progress on them.` : "The section is empty."}
        confirmLabel="Delete section"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </li>
  );
}

function AddItemMenu({ onPick, busy }: { onPick: (k: (typeof NEW_ITEM_KINDS)[number]) => void; busy: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" loading={busy} data-testid="item-add">
          <Plus /> Add item
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {NEW_ITEM_KINDS.map((k) => (
          <DropdownMenuItem key={k.key} onSelect={() => onPick(k)} data-testid={`item-add-${k.key}`}>
            {k.icon} {k.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Items ──────────────────────────────────────────────────────────────────

function ItemRow({ course, item, editable, selected, onOpen }: { course: AdminCourse; item: AdminItemSummary; editable: boolean; selected: boolean; onOpen: () => void }) {
  const qc = useQueryClient();
  const setCourse = useSetCourse(course.id);
  const sortable = useSortable({ id: itemDndId(item.id), data: { type: "item" }, disabled: !editable });
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patchSummary = (p: Partial<AdminItemSummary>) =>
    setCourse((c) => ({ ...c, sections: c.sections.map((s) => ({ ...s, items: s.items.map((i) => (i.id === item.id ? { ...i, ...p } : i)) })) }));

  const update = useMutation({
    mutationFn: (p: { title?: string; isPreview?: boolean }) => api().authoring.items.update(course.id, item.id, p),
    onMutate: (p) => patchSummary(p),
    onSuccess: (full) => qc.setQueryData(itemKey(course.id, item.id), full),
    onError: () => void qc.invalidateQueries({ queryKey: courseKey(course.id) }),
  });
  const remove = useMutation({
    mutationFn: () => api().authoring.items.remove(course.id, item.id),
    onSuccess: () => {
      setCourse((c) => ({ ...c, sections: c.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.id !== item.id) })) }));
      void qc.invalidateQueries({ queryKey: courseKey(course.id) });
      toast.success({ title: `Deleted "${item.title}".` });
    },
  });

  const meta = useMemo(() => {
    const parts: ReactNode[] = [itemKindLabel(item.kind, item.lectureKind)];
    if (item.durationSeconds) parts.push(formatDuration(item.durationSeconds));
    if (item.kind === "QUIZ" && item.meta.questions !== undefined) parts.push(`${item.meta.questions} ${item.meta.questions === 1 ? "question" : "questions"}`);
    if (item.kind === "ASSIGNMENT" && item.meta.pending) parts.push(`${item.meta.pending} to review`);
    if (item.isPreview) parts.push("Free preview");
    if (item.videoStatus && item.lectureKind === "VIDEO") parts.push(<VideoStatusText key="v" status={item.videoStatus} />);
    return parts;
  }, [item]);

  const isLecture = item.kind === "LECTURE";
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn("group flex items-center gap-2 py-2", sortable.isDragging && "opacity-40", selected && "bg-primary/10")}
      data-testid={`item-${item.id}`}
    >
      {editable ? (
        <button
          type="button"
          className="inline-flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-subtle-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
          aria-label={`Move ${item.title}`}
          {...sortable.attributes}
          {...sortable.listeners}
          data-testid="item-handle"
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <span className="w-2" />
      )}
      <ItemIcon item={item} />
      <div className="min-w-0 flex-1">
        {renaming ? (
          <InlineRename
            label="Item title"
            value={item.title}
            maxLength={200}
            onDone={(t) => {
              setRenaming(false);
              if (t && t !== item.title) update.mutate({ title: t });
            }}
          />
        ) : (
          <button type="button" onClick={onOpen} className="block max-w-full truncate rounded-sm text-left text-[14.5px] font-medium hover:underline focus-visible:underline" data-testid="item-open">
            {item.title}
          </button>
        )}
        <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted-foreground">
          {meta.map((m, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden>·</span> : null}
              {m}
            </span>
          ))}
        </p>
      </div>
      {editable ? (
        <div className="flex shrink-0 items-center">
          {isLecture ? (
            <IconButton
              size="sm"
              label={item.isPreview ? `Stop offering ${item.title} as a free preview` : `Offer ${item.title} as a free preview`}
              aria-pressed={item.isPreview}
              onClick={() => update.mutate({ isPreview: !item.isPreview })}
              className={item.isPreview ? "text-primary" : undefined}
              data-testid="item-preview-toggle"
            >
              {item.isPreview ? <Eye /> : <EyeOff />}
            </IconButton>
          ) : null}
          <IconButton size="sm" label={`Rename ${item.title}`} onClick={() => setRenaming(true)} data-testid="item-rename">
            <Pencil />
          </IconButton>
          <IconButton size="sm" label={`Delete ${item.title}`} onClick={() => setConfirmDelete(true)} data-testid="item-delete">
            <Trash2 />
          </IconButton>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete "${item.title}"?`}
        description="Learner progress, attempts and submissions on it are removed too."
        confirmLabel="Delete item"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </li>
  );
}

/** Rename in place: Enter or leaving the field saves, Escape cancels. */
export function InlineRename({ value, onDone, label, maxLength }: { value: string; onDone: (v: string | null) => void; label: string; maxLength: number }) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <Input
      autoFocus
      aria-label={label}
      value={text}
      maxLength={maxLength}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(text.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(text.trim() || null);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }}
      className="h-8"
      data-testid="inline-rename"
    />
  );
}
