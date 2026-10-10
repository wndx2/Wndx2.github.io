import type { MathfieldElement } from 'mathlive';

interface Caret {
  value: string;
  position: number;
  selection: MathfieldElement['selection'];
}

const placeholders = (latex: string) => latex.split('\\placeholder').length - 1;

// Makes Backspace finish the job in the places where MathLive's leaves something that
// can't be deleted: a template key (an integral, a derivative, a power of nothing) whose
// remains end up on the far side of the caret, and a bracket pair entered from its left,
// which loses its opening bracket and then swallows every further press.
export function repairBackspace(field: MathfieldElement, changed: () => void) {
  const caret = (): Caret => ({ value: field.value, position: field.position, selection: field.selection });
  let before: Caret | undefined;
  // The last thing entered, while it is still untouched and has blanks left to fill.
  let template: { before: Caret; value: string; position: number } | undefined;

  // The caret is where a press changed nothing, though the field isn't empty.
  const unstick = () => {
    const start = field.position;
    if (start === 0) {
      // A power or subscript left without anything to be the power of.
      if (/^[\^_]/.test(field.value)) field.executeCommand('deleteForward');
      return;
    }
    field.executeCommand('moveToGroupEnd');
    const end = field.position;
    if (!field.getValue(start - 1, end + 1, 'latex').startsWith('\\left.')) {
      field.position = start;
      return;
    }
    // At the start of brackets whose opening one is already gone: drop the closing one.
    const body = field.getValue(start, end, 'latex');
    field.selection = { ranges: [[start - 1, end + 1]] };
    field.insert(body, { insertionMode: 'replaceSelection', selectionMode: 'after', format: 'latex' });
    field.position = start - 1;
    changed();
  };

  const onBeforeInput = (e: InputEvent) => {
    if (e.inputType === 'insertText') {
      before = caret();
      return;
    }
    const entered = template;
    template = undefined;
    if (e.inputType !== 'deleteContentBackward') return;
    const now = caret();
    if (entered && now.value === entered.value && now.position === entered.position) {
      // Nothing has been filled in yet, so take the whole template back out.
      e.preventDefault();
      field.setValue(entered.before.value, { silenceNotifications: true });
      field.selection = entered.before.selection;
      changed();
      return;
    }
    queueMicrotask(() => {
      if (field.value !== '' && field.value === now.value && field.position === now.position) unstick();
    });
  };

  const onInput = (e: Event) => {
    const from = before;
    before = undefined;
    template =
      (e as InputEvent).inputType === 'insertText' && from && placeholders(field.value) > placeholders(from.value)
        ? { before: from, value: field.value, position: field.position }
        : undefined;
  };

  field.addEventListener('beforeinput', onBeforeInput);
  field.addEventListener('input', onInput);
  return () => {
    field.removeEventListener('beforeinput', onBeforeInput);
    field.removeEventListener('input', onInput);
  };
}
