import { WorkspaceLeaf, type ViewState } from 'obsidian';

/** View type registered by this plugin for .canvas files. */
export const VIEW_TYPE = 'visual-canvas';
/** Obsidian's own canvas view type. */
export const NATIVE_TYPE = 'canvas';
/** Marker in a view state asking to keep Obsidian's own canvas view. */
export const NATIVE_FLAG = 'vcNative';

type SetViewState = (this: WorkspaceLeaf, viewState: ViewState, eState?: unknown) => Promise<void>;

/**
 * .canvas is already claimed by the core Canvas plugin, so a second
 * registerExtensions() call would throw. Instead every request to show the
 * core canvas view is redirected to ours, unless the caller explicitly asked
 * for the native view. Returns the function that restores the original.
 */
export function installCanvasTakeover(isEnabled: (path: string | undefined) => boolean): () => void {
  const proto = WorkspaceLeaf.prototype as unknown as { setViewState: SetViewState };
  const original = proto.setViewState;
  const patched: SetViewState = function (this: WorkspaceLeaf, viewState, eState) {
    if (viewState && viewState.type === NATIVE_TYPE) {
      const state = (viewState.state ?? {}) as Record<string, unknown>;
      if (state[NATIVE_FLAG]) {
        const { [NATIVE_FLAG]: _drop, ...rest } = state;
        viewState = { ...viewState, state: rest };
      } else if (isEnabled(typeof state.file === 'string' ? state.file : undefined)) {
        viewState = { ...viewState, type: VIEW_TYPE };
      }
    }
    return original.call(this, viewState, eState);
  };
  proto.setViewState = patched;
  return () => {
    if (proto.setViewState === patched) proto.setViewState = original;
  };
}

/** Re-open the file shown in a leaf with the other canvas view. */
export async function switchCanvasView(leaf: WorkspaceLeaf, to: 'native' | 'visual'): Promise<void> {
  const current = leaf.getViewState();
  const file = (current.state as Record<string, unknown> | undefined)?.file;
  if (typeof file !== 'string') return;
  // Write what the open view still holds before another view reads the file.
  const view = leaf.view as { save?: () => Promise<void>; getViewType(): string };
  if (typeof view.save === 'function' && (view.getViewType() === VIEW_TYPE || view.getViewType() === NATIVE_TYPE)) await view.save();
  if (to === 'native') {
    await leaf.setViewState({ type: NATIVE_TYPE, state: { file, [NATIVE_FLAG]: true } });
  } else {
    await leaf.setViewState({ type: VIEW_TYPE, state: { file } });
  }
}
