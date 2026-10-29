import { WorkspaceLeaf, type App, type ViewState } from 'obsidian';

/** View type registered by this plugin for .canvas files. */
export const VIEW_TYPE = 'director-canvas';
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
      const state = (viewState.state ?? {});
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
  const file = (current.state)?.file;
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

interface ViewRegistry {
  registerExtensions: (this: ViewRegistry, exts: string[], type: string) => void;
  unregisterExtensions: (this: ViewRegistry, exts: string[]) => void;
  isExtensionRegistered: (this: ViewRegistry, ext: string) => boolean;
}

/**
 * With the core Canvas plugin turned off, nothing claims .canvas files, so Obsidian hands them to
 * the system. Then Director Canvas claims them itself, and gives them back the moment the core
 * plugin is turned on again (its own claim would otherwise fail). Returns the clean-up.
 */
export function installExtensionFallback(app: App): () => void {
  const vr = (app as unknown as { viewRegistry?: ViewRegistry }).viewRegistry;
  if (!vr || typeof vr.registerExtensions !== 'function') return () => {};
  let owned = false;
  const origRegister = vr.registerExtensions;
  const origUnregister = vr.unregisterExtensions;
  const claim = () => {
    if (owned || vr.isExtensionRegistered('canvas')) return;
    try { origRegister.call(vr, ['canvas'], VIEW_TYPE); owned = true; } catch { /* someone else has it */ }
  };
  vr.registerExtensions = function (this: ViewRegistry, exts: string[], type: string) {
    if (owned && type !== VIEW_TYPE && exts.includes('canvas')) {
      origUnregister.call(this, ['canvas']);
      owned = false;
    }
    return origRegister.call(this, exts, type);
  };
  vr.unregisterExtensions = function (this: ViewRegistry, exts: string[]) {
    const r = origUnregister.call(this, exts);
    if (!owned && exts.includes('canvas')) window.setTimeout(claim, 0);
    return r;
  };
  claim();
  return () => {
    vr.registerExtensions = origRegister;
    vr.unregisterExtensions = origUnregister;
    if (owned) { try { origUnregister.call(vr, ['canvas']); } catch { /* ignore */ } owned = false; }
  };
}

/** Whether Obsidian's own Canvas plugin is on (its view exists only then). */
export function coreCanvasOn(app: App): boolean {
  const ip = (app as unknown as { internalPlugins?: { getPluginById?(id: string): { enabled?: boolean } | null } }).internalPlugins;
  return !!ip?.getPluginById?.('canvas')?.enabled;
}
