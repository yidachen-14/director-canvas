import { type Command, type EditorState, type Transaction, TextSelection } from 'prosemirror-state';
import type { MarkType, NodeType, Attrs } from 'prosemirror-model';
import { setBlockType, toggleMark, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { schema, type Align } from './schema';

/** Whether a mark is active over the selection (or stored at the cursor). */
export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

/** The mark's attrs at the selection start, if present. */
export function markAttrs(state: EditorState, type: MarkType): Attrs | null {
  const { $from, empty } = state.selection;
  const marks = empty ? state.storedMarks || $from.marks() : $from.marksAcross(state.selection.$to) ?? $from.marks();
  return type.isInSet(marks)?.attrs ?? null;
}

/** Set (or replace) a mark with attrs over the selection; null removes it. */
export function setMark(type: MarkType, attrs: Attrs | null): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (!dispatch) return true;
    let tr = state.tr;
    if (empty) {
      tr = attrs ? tr.addStoredMark(type.create(attrs)) : tr.removeStoredMark(type);
    } else {
      tr = tr.removeMark(from, to, type);
      if (attrs) tr = tr.addMark(from, to, type.create(attrs));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

export const toggle = (name: keyof typeof schema.marks): Command => toggleMark(schema.marks[name]);

/** The textblock type at the selection: 'paragraph', 'h1'…'h6' or 'code'. */
export function blockKind(state: EditorState): string {
  const node = state.selection.$from.parent;
  if (node.type === schema.nodes.heading) return `h${node.attrs.level}`;
  if (node.type === schema.nodes.code_block) return 'code';
  return 'paragraph';
}

/** Turn the selected textblocks into a paragraph or heading, keeping alignment. */
export function setTextBlock(kind: string): Command {
  return (state, dispatch) => {
    const align = state.selection.$from.parent.attrs.align ?? null;
    if (kind === 'paragraph') return setBlockType(schema.nodes.paragraph, { align })(state, dispatch);
    if (kind === 'code') return setBlockType(schema.nodes.code_block)(state, dispatch);
    const level = Number(kind.slice(1));
    return setBlockType(schema.nodes.heading, { level, align })(state, dispatch);
  };
}

/** Align the textblocks touched by the selection. */
export function setAlign(align: Align): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    let tr = state.tr, changed = false;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === schema.nodes.paragraph || node.type === schema.nodes.heading) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, align: align === 'left' ? null : align });
        changed = true;
      }
    });
    if (changed && dispatch) dispatch(tr);
    return changed;
  };
}

/** Current alignment at the selection start. */
export function currentAlign(state: EditorState): Align {
  return (state.selection.$from.parent.attrs.align as Align) ?? 'left';
}

/** Align every block in a document (used from a card's menu when not editing). */
export function alignDoc(state: EditorState, align: Align): Transaction {
  let tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (node.type === schema.nodes.paragraph || node.type === schema.nodes.heading) {
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, align: align === 'left' ? null : align });
    }
  });
  return tr;
}

/** Which list (if any) the selection is in, and whether it is a task list. */
export function listKind(state: EditorState): 'bullet' | 'ordered' | 'task' | null {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type === schema.nodes.list_item) {
      const list = $from.node(d - 1);
      if (n.attrs.checked !== null) return 'task';
      return list.type === schema.nodes.ordered_list ? 'ordered' : 'bullet';
    }
  }
  return null;
}

function setTaskAttr(state: EditorState, tr: Transaction, task: boolean): Transaction {
  const { from, to } = state.selection;
  tr.doc.nodesBetween(tr.mapping.map(from), tr.mapping.map(to), (node, pos) => {
    if (node.type === schema.nodes.list_item) tr = tr.setNodeMarkup(pos, undefined, { checked: task ? (node.attrs.checked ?? ' ') : null });
  });
  return tr;
}

/** Toggle a list kind: off when already that kind, converted when another list. */
export function toggleList(kind: 'bullet' | 'ordered' | 'task'): Command {
  return (state, dispatch) => {
    const current = listKind(state);
    const listType: NodeType = kind === 'ordered' ? schema.nodes.ordered_list : schema.nodes.bullet_list;
    if (current === kind) return liftListItem(schema.nodes.list_item)(state, dispatch);
    if (current) {
      // Convert the surrounding list.
      if (!dispatch) return true;
      const $from = state.selection.$from;
      let tr = state.tr;
      for (let d = $from.depth; d > 0; d--) {
        const n = $from.node(d);
        if (n.type === schema.nodes.bullet_list || n.type === schema.nodes.ordered_list) {
          if (n.type !== listType) tr = tr.setNodeMarkup($from.before(d), listType, listType === schema.nodes.ordered_list ? { order: 1, tight: n.attrs.tight } : { tight: n.attrs.tight });
          break;
        }
      }
      tr = setTaskAttr(state, tr, kind === 'task');
      dispatch(tr);
      return true;
    }
    return wrapInList(listType)(state, (tr) => {
      if (dispatch) dispatch(kind === 'task' ? setTaskAttr(state, tr, true) : tr);
    });
  };
}

export function toggleQuote(): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from;
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === schema.nodes.blockquote) return lift(state, dispatch);
    return wrapIn(schema.nodes.blockquote)(state, dispatch);
  };
}

export const indentItem: Command = sinkListItem(schema.nodes.list_item);
export const outdentItem: Command = liftListItem(schema.nodes.list_item);

/** Remove every mark from the selection. */
export const clearFormatting: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty) return false;
  if (dispatch) {
    let tr = state.tr;
    for (const name of Object.keys(schema.marks)) tr = tr.removeMark(from, to, schema.marks[name]);
    dispatch(tr);
  }
  return true;
};

export function insertRule(): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()).scrollIntoView());
    return true;
  };
}

/** Put the cursor at the end of the document. */
export function selectEnd(state: EditorState): Transaction {
  return state.tr.setSelection(TextSelection.atEnd(state.doc));
}
