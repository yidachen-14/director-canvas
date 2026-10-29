import { Platform } from 'obsidian';
import type { Board } from './board';

/**
 * Phones and tablets: Obsidian's own bottom bar (and the home indicator) can sit over the board.
 * The board's floating controls keep clear of them by lifting the bottom of their layer.
 */
export function attachInsets(board: Board): void {
  if (!Platform.isMobile) return;
  const doc = board.root.ownerDocument;
  const win = doc.defaultView ?? window;
  // env(safe-area-inset-bottom) can only be read through an element that uses it.
  const probe = doc.body.createDiv();
  probe.setCssStyles({ position: 'fixed', left: '0', bottom: '0', width: '0', height: '0', paddingBottom: 'env(safe-area-inset-bottom)', visibility: 'hidden', pointerEvents: 'none' });
  const update = () => {
    const r = board.root.getBoundingClientRect();
    if (!r.height) return;
    let covered = 0;
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('.mobile-navbar, .mobile-toolbar'))) {
      const b = el.getBoundingClientRect();
      if (!b.height || !b.width || el.offsetParent === null) continue;
      if (b.right <= r.left || b.left >= r.right) continue;
      if (b.top < r.bottom && b.bottom > r.top) covered = Math.max(covered, r.bottom - b.top);
    }
    const safe = r.bottom >= win.innerHeight - 1 ? probe.offsetHeight : 0;
    const inset = Math.max(0, Math.round(Math.max(covered, safe)));
    board.uiEl.style.bottom = inset ? `${inset}px` : '';
  };
  const ro = new ResizeObserver(update);
  ro.observe(board.root);
  win.addEventListener('resize', update);
  const ref = board.app.workspace.on('layout-change', update);
  const timer = win.setInterval(update, 1500); // the bar slides in and out without telling anyone
  update();
  board.addDisposer(() => {
    ro.disconnect();
    win.removeEventListener('resize', update);
    board.app.workspace.offref(ref);
    win.clearInterval(timer);
    probe.remove();
  });
}
