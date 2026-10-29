// Obsidian adds createDiv/createEl to the global scope; tests running in jsdom get small stand-ins.
const g = globalThis as Record<string, unknown>;
if (typeof document !== 'undefined') {
  g.createEl ??= (tag: string, o?: { cls?: string; text?: string }) => {
    const el = document.createElement(tag);
    if (o?.cls) el.className = o.cls;
    if (o?.text) el.textContent = o.text;
    return el;
  };
  g.createDiv ??= (o?: { cls?: string; text?: string } | string) => (g.createEl as (t: string, o?: unknown) => HTMLElement)('div', typeof o === 'string' ? { cls: o } : o);
}
