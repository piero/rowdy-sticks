import { Editor } from './state';
import { Stage } from './stage';
import { Timeline } from './timeline';
import { mountInspector, mountScenePanel } from './panels';
import { openExportDialog } from './exportDialog';
import { button, h, replaceChildren } from './dom';
import { createFigure, newProject, normalizeProject } from '../model/project';
import { demoProject } from '../anim/demo';
import { clonePose, ensureKey, evaluate } from '../model/pose';
import { alertUser, confirmUser, inTiny, openTextFile, saveFile } from '../platform/files';
import logoUrl from '../../assets/icon.png';

export function startApp(root: HTMLElement) {
  // ?demo forces the demo (ignoring the autosave); ?frame=N opens at a frame.
  const params = new URLSearchParams(location.search);
  const ed = new Editor((!params.has('demo') && Editor.loadAutosave()) || demoProject());
  if (params.has('frame')) ed.frame = Math.max(0, Math.min(ed.project.frames - 1, Number(params.get('frame')) || 0));

  const toolbar = h('header', { class: 'toolbar' });
  const left = h('aside', { class: 'panel left' });
  const stageHost = h('main', { class: 'stage' });
  const right = h('aside', { class: 'panel right' });
  const transport = h('div', { class: 'transport' });
  const tlHost = h('div', { class: 'timeline' });
  const statusBar = h('footer', { class: 'statusbar' });
  root.append(toolbar, h('div', { class: 'workspace' }, left, stageHost, right), h('div', { class: 'bottom' }, transport, tlHost), statusBar);

  const hint = h('span', { class: 'hint-text' });
  const fileLabel = h('span', { class: 'file-label' });
  statusBar.append(hint, fileLabel);
  const setStatus = (msg: string) => { hint.textContent = msg || defaultHint(); };
  const defaultHint = () => ed.playing
    ? 'Playing — Space to stop'
    : 'Drag joints to pose · Shift = ' + (ed.tool === 'ik' ? 'FK' : 'IK') + ' · Space+drag or right-drag pans · wheel zooms · double-click stage to fit';

  const stage = new Stage(ed, stageHost, setStatus);
  const timeline = new Timeline(ed, tlHost);
  mountScenePanel(ed, left);
  mountInspector(ed, right);

  // ------------------------------------------------------------------ actions

  const actions = {
    newProject: async () => {
      if (!(await confirmUser('Start a new animation?', 'Unsaved changes will be lost (undo history is cleared).'))) return;
      const p = newProject();
      p.figures.push(createFigure(p, 'plain', p.width / 2));
      ed.replaceProject(p);
      stage.fit();
    },
    demo: async () => {
      if (!(await confirmUser('Load the demo fight?', 'This replaces the current animation.'))) return;
      ed.replaceProject(demoProject());
      stage.fit();
    },
    open: async () => {
      const file = await openTextFile(['json', 'stickman']);
      if (!file) return;
      try {
        ed.replaceProject(normalizeProject(JSON.parse(file.text)), file.name);
        stage.fit();
      } catch (err) {
        await alertUser('Could not open file', err instanceof Error ? err.message : String(err));
      }
    },
    save: async (as = false) => {
      const json = JSON.stringify(ed.project, null, 1);
      if (inTiny && ed.fileName && ed.fileName.includes('/') && !as) {
        await tiny.api.call('writeText', { path: ed.fileName, text: json });
        flash(`Saved ${ed.fileName}`);
        return;
      }
      const saved = await saveFile(ed.project.name || 'animation', 'json', 'application/json', json);
      if (saved) { ed.fileName = saved; updateFileLabel(); flash(`Saved ${saved}`); }
    },
    export: () => { stopPlayback(); openExportDialog(ed); },
    undo: () => { if (ed.canUndo()) ed.undo(); },
    redo: () => { if (ed.canRedo()) ed.redo(); },
    togglePlay: () => (ed.playing ? stopPlayback() : startPlayback()),
    prevKey: () => jumpKey(-1),
    nextKey: () => jumpKey(1),
    addKey: () => {
      const fig = ed.fig;
      if (!fig) return;
      ed.checkpoint();
      ensureKey(fig, ed.frame);
      ed.selKey = ed.frame;
      ed.changed(true);
    },
    deleteKey: () => {
      const fig = ed.fig;
      if (!fig || fig.keys.length <= 1) return;
      const k = fig.keys.find((kk) => kk.frame === ed.frame);
      if (!k) return;
      ed.checkpoint();
      fig.keys = fig.keys.filter((kk) => kk !== k);
      ed.selKey = null;
      ed.changed(true);
    },
    copyPose: () => {
      const fig = ed.fig;
      if (!fig) return;
      const k = fig.keys.find((kk) => kk.frame === ed.frame);
      ed.clipboard = clonePose(k?.pose ?? evaluate(fig, ed.frame));
      flash('Pose copied');
      ed.emit('selection');
    },
    pastePose: () => {
      const fig = ed.fig, c = ed.clipboard;
      if (!fig || !c) return;
      ed.checkpoint();
      const k = ensureKey(fig, ed.frame);
      Object.assign(k.pose, clonePose({ ...c, x: k.pose.x, y: k.pose.y }));
      ed.selKey = ed.frame;
      ed.changed(true);
    },
    flip: () => {
      const fig = ed.fig;
      if (!fig) return;
      ed.checkpoint();
      const k = ensureKey(fig, ed.frame);
      k.pose.flip = !k.pose.flip;
      ed.changed(true);
    },
    toggleTool: () => { ed.tool = ed.tool === 'fk' ? 'ik' : 'fk'; renderToolbar(); setStatus(''); },
    toggleOnion: () => { ed.onion = !ed.onion; renderToolbar(); ed.emit('view'); },
    toggleFx: () => { ed.showFx = !ed.showFx; renderToolbar(); ed.emit('view'); },
  };

  function jumpKey(dir: 1 | -1) {
    const frames = new Set<number>();
    const figs = ed.fig ? [ed.fig] : ed.project.figures;
    for (const f of figs) for (const k of f.keys) frames.add(k.frame);
    const sorted = [...frames].sort((a, b) => a - b);
    const target = dir > 0 ? sorted.find((f) => f > ed.frame) : [...sorted].reverse().find((f) => f < ed.frame);
    if (target !== undefined) ed.setFrame(target);
  }

  // ------------------------------------------------------------------ playback

  let raf = 0;
  function startPlayback() {
    if (ed.frame >= ed.project.frames - 1) ed.setFrame(0);
    ed.playing = true;
    const t0 = performance.now(), f0 = ed.frame;
    const step = (now: number) => {
      if (!ed.playing) return;
      let f = f0 + Math.floor(((now - t0) * ed.project.fps) / 1000);
      if (f >= ed.project.frames) {
        if (!ed.loop) { ed.setFrame(ed.project.frames - 1); stopPlayback(); return; }
        f %= ed.project.frames;
      }
      ed.setFrame(f);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    renderTransport();
    setStatus('');
    ed.emit('view');
  }
  function stopPlayback() {
    if (!ed.playing) return;
    ed.playing = false;
    cancelAnimationFrame(raf);
    renderTransport();
    setStatus('');
    ed.emit('view');
    ed.emit('selection');
  }

  // ------------------------------------------------------------------ toolbar & transport

  function renderToolbar() {
    const toggle = (label: string, on: boolean, fn: () => void, title: string) =>
      button(label, fn, { class: on ? 'toggle on' : 'toggle', title });
    replaceChildren(toolbar,
      h('div', { class: 'brand' }, h('img', { class: 'logo', src: logoUrl, alt: '' }), 'Rowdy Sticks'),
      h('div', { class: 'group' },
        button('New', actions.newProject, { title: 'New animation (⌘N)' }),
        button('Open…', actions.open, { title: 'Open project (⌘O)' }),
        button('Save', () => actions.save(), { title: 'Save project as JSON (⌘S)' }),
        button('Demo', actions.demo, { title: 'Load the ninja vs samurai demo' }),
      ),
      h('div', { class: 'group' },
        button('↶', actions.undo, { title: 'Undo (⌘Z)', class: 'icon' }),
        button('↷', actions.redo, { title: 'Redo (⇧⌘Z)', class: 'icon' }),
      ),
      h('div', { class: 'group' },
        toggle(ed.tool === 'ik' ? 'IK' : 'FK', ed.tool === 'ik', actions.toggleTool, 'Posing mode: FK rotates one bone, IK drags hands/feet and bends the limb (I). Hold Shift to use the other.'),
        toggle('Onion', ed.onion, actions.toggleOnion, 'Show previous/next keyframes (O)'),
        toggle('FX', ed.showFx, actions.toggleFx, 'Preview hit effects and trails in the editor'),
        button('Fit', () => { stage.fit(); timeline.zoomToFit(); }, { title: 'Fit stage and timeline to view' }),
      ),
      h('div', { class: 'spacer' }),
      button('Export…', actions.export, { class: 'primary', title: 'Export GIF, MP4 or sprite sheet (⌘E)' }),
    );
  }

  const frameInput = h('input', {
    type: 'number', class: 'num frame-input', min: 0,
    onchange: (e: Event) => ed.setFrame(Number((e.target as HTMLInputElement).value)),
  });
  const frameTotal = h('span', { class: 'frame-total' });
  function renderTransport() {
    replaceChildren(transport,
      button('⏮', () => ed.setFrame(0), { class: 'icon', title: 'First frame (Home)' }),
      button('◆◀', actions.prevKey, { class: 'icon', title: 'Previous key (⇧←)' }),
      button('◀', () => ed.setFrame(ed.frame - 1), { class: 'icon', title: 'Previous frame (←)' }),
      button(ed.playing ? '❚❚' : '▶', actions.togglePlay, { class: 'icon play', title: 'Play / pause (Space)' }),
      button('▶', () => ed.setFrame(ed.frame + 1), { class: 'icon', title: 'Next frame (→)' }),
      button('▶◆', actions.nextKey, { class: 'icon', title: 'Next key (⇧→)' }),
      button('⏭', () => ed.setFrame(ed.project.frames - 1), { class: 'icon', title: 'Last frame (End)' }),
      h('span', { class: 'frame-box' }, frameInput, frameTotal),
      button(ed.loop ? 'Loop ✓' : 'Loop', () => { ed.loop = !ed.loop; renderTransport(); }, { class: ed.loop ? 'toggle on' : 'toggle' }),
      h('span', { class: 'sep' }),
      button('+ Key', actions.addKey, { title: 'Add key for the selected stickman (K)' }),
      button('− Key', actions.deleteKey, { title: 'Delete key at this frame (Delete)' }),
      h('span', { class: 'hint-inline' }, 'Double-click a timeline row to add a key, drag diamonds to retime.'),
    );
    updateFrame();
  }
  function updateFrame() {
    if (document.activeElement !== frameInput) frameInput.value = String(ed.frame);
    frameInput.max = String(ed.project.frames - 1);
    frameTotal.textContent = `/ ${ed.project.frames - 1}`;
  }
  function updateFileLabel() {
    fileLabel.textContent = (ed.fileName ? ed.fileName.split(/[\\/]/).pop() + ' · ' : '') + (inTiny ? 'desktop' : 'browser');
  }
  let flashTimer = 0;
  function flash(msg: string) {
    hint.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => setStatus(''), 2500);
  }

  ed.on('frame', updateFrame);
  ed.on('structure', () => { updateFrame(); updateFileLabel(); });

  // ------------------------------------------------------------------ keyboard & menu

  // Menu accelerators and keydown can both fire for the same shortcut; run each once.
  const lastRun = new Map<string, number>();
  const runOnce = (id: string, fn: () => void) => {
    const now = performance.now();
    if (now - (lastRun.get(id) ?? -1e9) < 150) return;
    lastRun.set(id, now);
    fn();
  };

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod) {
      const map: Record<string, [string, () => void]> = {
        z: e.shiftKey ? ['redo', actions.redo] : ['undo', actions.undo],
        y: ['redo', actions.redo],
        s: e.shiftKey ? ['saveAs', () => actions.save(true)] : ['save', () => actions.save()],
        o: ['open', actions.open],
        e: ['export', actions.export],
        n: ['new', actions.newProject],
      };
      if (!typing) {
        map.c = ['copy', actions.copyPose];
        map.v = ['paste', actions.pastePose];
      }
      if (typing && (k === 'z' || k === 'y')) return; // let text fields undo their own text
      const hit = map[k];
      if (hit) { e.preventDefault(); runOnce(hit[0], hit[1]); }
      return;
    }
    if (typing || document.querySelector('.modal-overlay')) return;
    switch (e.key) {
      case ' ': e.preventDefault(); actions.togglePlay(); break;
      case 'ArrowLeft': e.preventDefault(); e.shiftKey ? actions.prevKey() : ed.setFrame(ed.frame - 1); break;
      case 'ArrowRight': e.preventDefault(); e.shiftKey ? actions.nextKey() : ed.setFrame(ed.frame + 1); break;
      case 'Home': ed.setFrame(0); break;
      case 'End': ed.setFrame(ed.project.frames - 1); break;
      case 'Delete': case 'Backspace': actions.deleteKey(); break;
      default:
        if (k === 'k') actions.addKey();
        else if (k === 'f') actions.flip();
        else if (k === 'i') actions.toggleTool();
        else if (k === 'o') actions.toggleOnion();
    }
  });

  if (inTiny) {
    const menuActions: Record<string, () => void> = {
      new: actions.newProject, demo: actions.demo, open: actions.open, save: () => actions.save(), saveAs: () => actions.save(true),
      export: actions.export, undo: actions.undo, redo: actions.redo, play: actions.togglePlay,
      addKey: actions.addKey, deleteKey: actions.deleteKey, flip: actions.flip, tool: actions.toggleTool, onion: actions.toggleOnion,
    };
    tiny.menu.set([
      { title: 'File', items: [
        { id: 'new', label: 'New', key: 'n' },
        { id: 'demo', label: 'Open Demo Fight' },
        { id: 'open', label: 'Open…', key: 'o' },
        { separator: true },
        { id: 'save', label: 'Save', key: 's' },
        { id: 'saveAs', label: 'Save As…', key: 'S' },
        { separator: true },
        { id: 'export', label: 'Export…', key: 'e' },
      ] },
      { role: 'edit', items: [
        { id: 'undo', label: 'Undo', key: 'z' },
        { id: 'redo', label: 'Redo', key: 'Z' },
        { separator: true },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ] },
      { title: 'Animation', items: [
        { id: 'play', label: 'Play / Pause' },
        { id: 'addKey', label: 'Add Key' },
        { id: 'deleteKey', label: 'Delete Key' },
        { separator: true },
        { id: 'flip', label: 'Flip Facing' },
        { id: 'tool', label: 'Toggle FK / IK' },
        { id: 'onion', label: 'Toggle Onion Skin' },
      ] },
    ] as TinyMenu[]).catch((err: unknown) => console.warn('menu.set failed', err));
    tiny.menu.on((id) => { const fn = menuActions[id]; if (fn) runOnce(id, fn); });
  }

  renderToolbar();
  renderTransport();
  updateFileLabel();
  setStatus('');
  window.addEventListener('beforeunload', () => stopPlayback());
}
