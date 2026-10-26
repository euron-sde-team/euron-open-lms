"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderTree, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, IconButton, Input, Skeleton, Textarea, cn, toast } from "@open-lms/ui";
import type { Category } from "@open-lms/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { AdminPage } from "@/components/admin/shell/admin-page";
import { useAdminSession } from "@/components/admin/shell/session";

const key = qk.admin.list("categories");

export function CategoriesPage() {
  const viewer = useAdminSession();
  const qc = useQueryClient();
  const canWrite = viewer.isAdmin;
  const list = useQuery({ queryKey: key, queryFn: () => api().authoring.categories.list() });
  const [order, setOrder] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  useEffect(() => {
    if (list.data) setOrder(list.data);
  }, [list.data]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api().authoring.categories.reorder(ids),
    meta: { silent: true },
    onSuccess: (cats) => qc.setQueryData(key, cats),
    onError: (e) => {
      if (list.data) setOrder(list.data);
      toast.error({ title: `The new order was not saved. ${errorMessage(e)}` });
    },
  });
  const remove = useMutation({
    mutationFn: (c: Category) => api().authoring.categories.remove(c.id),
    onSuccess: (_r, c) => {
      qc.setQueryData<Category[]>(key, (cur) => cur?.filter((x) => x.id !== c.id));
      void qc.invalidateQueries({ queryKey: qk.categories });
      toast.success({ title: `Deleted "${c.name}".` });
    },
  });

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = order.findIndex((c) => c.id === e.active.id);
    const to = order.findIndex((c) => c.id === e.over!.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    reorder.mutate(next.map((c) => c.id));
  };
  const nameOf = (id: string | number) => order.find((c) => c.id === id)?.name ?? "category";
  const posOf = (id: string | number) => `position ${order.findIndex((c) => c.id === id) + 1} of ${order.length}`;

  return (
    <AdminPage
      title="Categories"
      description={canWrite ? "How the catalog is grouped. The order here is the order learners see." : "How the catalog is grouped. Only administrators change categories."}
      testId="admin-categories"
      actions={
        canWrite ? (
          <Button onClick={() => setEditing("new")} data-testid="category-new">
            <Plus /> New category
          </Button>
        ) : null
      }
    >
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <ul className="divide-y divide-border border-y border-border" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex items-center gap-3 py-3.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-4 w-16" />
            </li>
          ))}
        </ul>
      ) : !order.length ? (
        <EmptyState icon={<FolderTree />} title="No categories yet" description="Categories group courses in the catalog and give generated covers their colours." action={canWrite ? <Button size="sm" onClick={() => setEditing("new")}>New category</Button> : undefined} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, ${posOf(active.id)}.`,
              onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} is over ${nameOf(over.id)}.` : `${nameOf(active.id)} is not over a place.`),
              onDragEnd: ({ active, over }) => (over ? `Dropped ${nameOf(active.id)} at ${posOf(over.id)}.` : `${nameOf(active.id)} was dropped back.`),
              onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} was cancelled.`,
            },
          }}
        >
          <SortableContext items={order.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-border border-y border-border" data-testid="categories-list">
              {order.map((c) => (
                <CategoryRow key={c.id} category={c} canWrite={canWrite} onEdit={() => setEditing(c)} onDelete={() => setDeleting(c)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <CategoryDialog category={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name ?? ""}"?`}
        description={deleting?.courseCount ? `${deleting.courseCount} ${deleting.courseCount === 1 ? "course loses" : "courses lose"} this category. The courses themselves are not changed otherwise.` : "No course uses it."}
        confirmLabel="Delete category"
        destructive
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting);
        }}
      />
    </AdminPage>
  );
}

function CategoryRow({ category, canWrite, onEdit, onDelete }: { category: Category; canWrite: boolean; onEdit: () => void; onDelete: () => void }) {
  const s = useSortable({ id: category.id, disabled: !canWrite });
  return (
    <li ref={s.setNodeRef} style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }} className={cn("flex items-center gap-3 bg-background py-3", s.isDragging && "relative z-10 opacity-70")} data-testid={`category-${category.slug}`}>
      {canWrite ? (
        <button type="button" className="inline-flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-subtle-foreground hover:bg-muted hover:text-foreground" aria-label={`Move ${category.name}`} {...s.attributes} {...s.listeners} data-testid="category-handle">
          <GripVertical className="size-4" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{category.name}</p>
        <p className="truncate text-[13px] text-muted-foreground">
          /{category.slug}
          {category.description ? ` · ${category.description}` : ""}
        </p>
      </div>
      <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
        {category.courseCount} {category.courseCount === 1 ? "course" : "courses"}
      </span>
      {canWrite ? (
        <div className="flex shrink-0">
          <IconButton size="sm" label={`Edit ${category.name}`} onClick={onEdit} data-testid="category-edit">
            <Pencil />
          </IconButton>
          <IconButton size="sm" label={`Delete ${category.name}`} onClick={onDelete} data-testid="category-delete">
            <Trash2 />
          </IconButton>
        </div>
      ) : null}
    </li>
  );
}

function CategoryDialog({ category, onClose }: { category: Category | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!category) return;
    setName(category === "new" ? "" : category.name);
    setSlug(category === "new" ? "" : category.slug);
    setDescription(category === "new" ? "" : (category.description ?? ""));
    setError(null);
  }, [category]);
  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), ...(slug.trim() ? { slug: slug.trim().toLowerCase() } : {}), description: description.trim() || null };
      if (category === "new") return api().authoring.categories.create(body);
      return api().authoring.categories.update(category!.id, body);
    },
    meta: { silent: true },
    onSuccess: (r) => {
      if (Array.isArray(r)) qc.setQueryData(key, r);
      else qc.setQueryData<Category[]>(key, (cur) => cur?.map((c) => (c.id === r.id ? r : c)));
      void qc.invalidateQueries({ queryKey: qk.categories });
      toast.success({ title: category === "new" ? "Category added." : "Category saved." });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const slugOk = (v: string) => v.length >= 3 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
  const valid = name.trim().length >= 1 && name.trim().length <= 60 && (!slug.trim() || slugOk(slug.trim().toLowerCase()));
  return (
    <Dialog open={!!category} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent size="sm" data-testid="category-dialog">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{category === "new" ? "New category" : "Edit category"}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Name" htmlFor="category-name">
              <Input id="category-name" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-testid="category-name" />
            </Field>
            <Field label="Address" htmlFor="category-slug" optional hint={slug.trim() && !slugOk(slug.trim().toLowerCase()) ? "At least 3 lowercase letters, digits and single hyphens." : "Made from the name when left empty."}>
              <Input id="category-slug" value={slug} maxLength={60} onChange={(e) => setSlug(e.target.value)} data-testid="category-slug" />
            </Field>
            <Field label="Description" htmlFor="category-description" optional>
              <Textarea id="category-description" rows={3} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="category-description" />
            </Field>
            {error ? (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid} loading={save.isPending} data-testid="category-save">
              {category === "new" ? "Add category" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
