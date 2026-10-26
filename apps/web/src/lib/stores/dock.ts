/**
 * Messenger dock: up to three open conversation windows, the rest as
 * minimised heads. UI-only state (thread data itself lives in React Query).
 * Kept in memory, not persisted: it survives client navigation, and a reload
 * or a different user starts clean.
 */
import { create } from "zustand";

export const MAX_OPEN = 3;
export const MAX_HEADS = 6;

export interface DockState {
  open: string[];
  minimized: string[];
}

export const emptyDock: DockState = { open: [], minimized: [] };

/** Pure transitions, unit-tested separately from the store. */
export const dock = {
  openThread(s: DockState, id: string, maxOpen = MAX_OPEN): DockState {
    if (s.open.includes(id)) return { ...s, open: [...s.open.filter((x) => x !== id), id] };
    const minimized = s.minimized.filter((x) => x !== id);
    let open = [...s.open, id];
    if (open.length > maxOpen) {
      const bumped = open.slice(0, open.length - maxOpen);
      open = open.slice(-maxOpen);
      return { open, minimized: [...bumped, ...minimized].slice(0, MAX_HEADS) };
    }
    return { open, minimized };
  },
  minimize(s: DockState, id: string): DockState {
    if (!s.open.includes(id)) return s;
    return { open: s.open.filter((x) => x !== id), minimized: [id, ...s.minimized.filter((x) => x !== id)].slice(0, MAX_HEADS) };
  },
  close(s: DockState, id: string): DockState {
    return { open: s.open.filter((x) => x !== id), minimized: s.minimized.filter((x) => x !== id) };
  },
  closeAll(): DockState {
    return emptyDock;
  },
};

interface DockStore extends DockState {
  openThread: (id: string) => void;
  minimize: (id: string) => void;
  close: (id: string) => void;
  closeAll: () => void;
  /** New-message window (no thread yet). */
  composerOpen: boolean;
  setComposerOpen: (v: boolean) => void;
}

export const useDock = create<DockStore>((set) => ({
  ...emptyDock,
  composerOpen: false,
  openThread: (id) => set((s) => dock.openThread(s, id, maxOpenForViewport())),
  minimize: (id) => set((s) => dock.minimize(s, id)),
  close: (id) => set((s) => dock.close(s, id)),
  closeAll: () => set({ ...dock.closeAll(), composerOpen: false }),
  setComposerOpen: (v) => set({ composerOpen: v }),
}));

/** Fewer windows fit on smaller screens. */
export function maxOpenForViewport(width = typeof window === "undefined" ? 1440 : window.innerWidth): number {
  if (width < 1024) return 1;
  if (width < 1400) return 2;
  return MAX_OPEN;
}
