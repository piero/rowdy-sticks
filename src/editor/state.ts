import type { Figure, Pose, Project } from '../model/types';
import { invalidateWorld } from '../sim/world';
import { normalizeProject } from '../model/project';

export type EditorEvent = 'project' | 'structure' | 'frame' | 'selection' | 'view';
export type Tool = 'fk' | 'ik';

const AUTOSAVE_KEY = 'rowdy-sticks:autosave';
/** Autosave key from before the rename, still read so existing work isn't lost. */
const LEGACY_AUTOSAVE_KEY = 'stickman-animator:autosave';
const HISTORY_LIMIT = 120;

export class Editor {
  project: Project;
  frame = 0;
  selFig: string | null = null;
  /** Frame of the selected keyframe (on the selected figure). */
  selKey: number | null = null;
  playing = false;
  loop = true;
  tool: Tool = 'fk';
  onion = false;
  showFx = true;
  clipboard: Pose | null = null;
  fileName: string | null = null;

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private editKey: string | null = null;
  private listeners = new Map<EditorEvent, Set<() => void>>();
  private saveTimer = 0;

  constructor(project: Project) {
    this.project = project;
    this.selFig = project.figures[0]?.id ?? null;
  }

  on(ev: EditorEvent, fn: () => void) {
    let s = this.listeners.get(ev);
    if (!s) { s = new Set(); this.listeners.set(ev, s); }
    s.add(fn);
  }

  emit(ev: EditorEvent) {
    this.listeners.get(ev)?.forEach((fn) => fn());
  }

  get fig(): Figure | null {
    return this.project.figures.find((f) => f.id === this.selFig) ?? null;
  }

  /**
   * Snapshot the project before a mutation. Repeated calls with the same `key`
   * (e.g. dragging a slider) collapse into one undo step.
   */
  checkpoint(key?: string) {
    if (key && key === this.editKey) return;
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.editKey = key ?? null;
  }

  /** Call after mutating the project. */
  changed(structural = false) {
    invalidateWorld();
    if (this.frame >= this.project.frames) this.frame = this.project.frames - 1;
    this.emit('project');
    if (structural) this.emit('structure');
    this.scheduleAutosave();
  }

  endEdit() { this.editKey = null; }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.restore(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.restore(next);
  }

  private restore(json: string) {
    this.project = JSON.parse(json);
    this.editKey = null;
    if (!this.fig) this.selFig = this.project.figures[0]?.id ?? null;
    this.changed(true);
    this.emit('selection');
  }

  replaceProject(p: Project, fileName: string | null = null) {
    this.project = p;
    this.fileName = fileName;
    this.undoStack = [];
    this.redoStack = [];
    this.editKey = null;
    this.frame = 0;
    this.selKey = null;
    this.selFig = p.figures[0]?.id ?? null;
    this.changed(true);
    this.emit('selection');
    this.emit('frame');
  }

  setFrame(f: number) {
    const n = Math.max(0, Math.min(this.project.frames - 1, Math.round(f)));
    if (n === this.frame) return;
    this.frame = n;
    const fig = this.fig;
    this.selKey = fig?.keys.some((k) => k.frame === n) ? n : null;
    this.emit('frame');
  }

  select(figId: string | null, keyFrame: number | null = null) {
    this.selFig = figId;
    this.selKey = keyFrame;
    this.emit('selection');
  }

  private scheduleAutosave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.project)); } catch { /* storage unavailable */ }
    }, 800);
  }

  static loadAutosave(): Project | null {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY) ?? localStorage.getItem(LEGACY_AUTOSAVE_KEY);
      return raw ? normalizeProject(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
}
