/** Tiny DOM helpers. All text goes through textContent — never innerHTML with data. */

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && k !== 'list' && k !== 'type') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'panel-section' }, h('h3', {}, title), ...children);
}

export function row(label: string, ...controls: Child[]): HTMLElement {
  return h('label', { class: 'row' }, h('span', { class: 'row-label' }, label), h('span', { class: 'row-ctl' }, ...controls));
}

export interface NumOpts { min?: number; max?: number; step?: number; range?: boolean; width?: string }

/** Number input (optionally a slider + readout). onInput fires live, onCommit on change. */
export function num(value: number, opts: NumOpts, onInput: (v: number) => void, onCommit?: (v: number) => void): HTMLElement {
  const parse = (s: string) => {
    const v = Number(s);
    return Number.isFinite(v) ? v : value;
  };
  if (opts.range) {
    const out = h('output', { class: 'readout' }, fmt(value, opts.step));
    const input = h('input', {
      type: 'range', min: opts.min, max: opts.max, step: opts.step ?? 1, value,
      oninput: (e: Event) => { const v = parse((e.target as HTMLInputElement).value); out.textContent = fmt(v, opts.step); onInput(v); },
      onchange: (e: Event) => onCommit?.(parse((e.target as HTMLInputElement).value)),
    });
    return h('span', { class: 'range' }, input, out);
  }
  return h('input', {
    type: 'number', min: opts.min, max: opts.max, step: opts.step ?? 1, value, class: 'num',
    oninput: (e: Event) => onInput(parse((e.target as HTMLInputElement).value)),
    onchange: (e: Event) => onCommit?.(parse((e.target as HTMLInputElement).value)),
  });
}

function fmt(v: number, step?: number) {
  const decimals = step && step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0;
  return v.toFixed(decimals);
}

export function select<T extends string>(value: T, options: [T, string][] | { group: string; items: [T, string][] }[], onChange: (v: T) => void): HTMLSelectElement {
  const el = h('select', { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as T) });
  const opt = ([v, label]: [T, string]) => h('option', { value: v, selected: v === value }, label);
  for (const o of options) {
    if (Array.isArray(o)) el.append(opt(o));
    else el.append(h('optgroup', { label: o.group }, ...o.items.map(opt)));
  }
  el.value = value;
  return el;
}

export function color(value: string, onInput: (v: string) => void, onCommit?: (v: string) => void): HTMLInputElement {
  return h('input', {
    type: 'color', value, class: 'color',
    oninput: (e: Event) => onInput((e.target as HTMLInputElement).value),
    onchange: (e: Event) => onCommit?.((e.target as HTMLInputElement).value),
  });
}

export function check(value: boolean, onChange: (v: boolean) => void, label?: string): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: value, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) });
  return label ? h('label', { class: 'check' }, input, h('span', {}, label)) : input;
}

export function button(label: string, onClick: () => void, opts: { title?: string; class?: string; disabled?: boolean } = {}): HTMLButtonElement {
  return h('button', { type: 'button', class: opts.class ?? '', title: opts.title, disabled: opts.disabled, onclick: () => onClick() }, label);
}

export function text(value: string, onInput: (v: string) => void, onCommit?: (v: string) => void): HTMLInputElement {
  return h('input', {
    type: 'text', value, class: 'text',
    oninput: (e: Event) => onInput((e.target as HTMLInputElement).value),
    onchange: (e: Event) => onCommit?.((e.target as HTMLInputElement).value),
  });
}

/** Keep the element in place but swap its children. */
export function replaceChildren(el: Element, ...children: Child[]) {
  el.replaceChildren(...(children.filter((c) => c !== null && c !== undefined && c !== false) as (Node | string)[]));
}
