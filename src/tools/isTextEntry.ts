/**
 * True while the user is TYPING into the element — and only then.
 *
 * Keyboard shortcuts must stand down for text entry, but a focused checkbox is
 * an INPUT too: clicking a row checkbox leaves focus on it, and a plain
 * tagName test then killed the shortcuts for the rest of the session, taking
 * the most natural flow of all (select, then Delete) with them.
 */
export default function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return (
    el.tagName === 'INPUT' &&
    !['checkbox', 'radio', 'button', 'submit'].includes((el as HTMLInputElement).type)
  );
}
