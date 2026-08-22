import { useRef, useEffect, RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Stacked dialogs portal as SIBLINGS under document.body, so a click inside
// the top dialog is "outside" every dialog below it, and each dialog's
// document-level Escape handler fires on the same keypress. Only the topmost
// dialog may react, or one interaction closes the whole stack.
const dialogStack: symbol[] = [];

export function useDialog(onClose: () => void): RefObject<HTMLDivElement | null> {
  const refDialog = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<symbol | null>(null);
  if (tokenRef.current === null) {
    tokenRef.current = Symbol('dialog');
  }

  useEffect(() => {
    const token = tokenRef.current as symbol;
    dialogStack.push(token);
    return () => {
      const pos = dialogStack.indexOf(token);
      if (pos !== -1) dialogStack.splice(pos, 1);
    };
  }, []);

  const isTopmost = () => dialogStack[dialogStack.length - 1] === tokenRef.current;

  // Close on click outside
  useEffect(() => {
    // A click event fires on the common ancestor of mousedown/mouseup, so a
    // text selection dragged from inside the dialog to outside it reports
    // <body> as its target and used to close the dialog, losing the input.
    // Only a press that STARTED outside counts as an outside click.
    let pressedInside = false;
    const handleBodyPointerDown = (e: MouseEvent) => {
      pressedInside = !!refDialog.current?.contains(e.target as Node);
    };
    const handleBodyClick = (e: MouseEvent) => {
      if (pressedInside) return;
      if (isTopmost() && refDialog.current && !refDialog.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleBodyPointerDown, true);
      document.addEventListener('click', handleBodyClick);
    }, 0);
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleBodyPointerDown, true);
      document.removeEventListener('click', handleBodyClick);
    };
  }, [onClose]);

  // Close on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopmost()) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Focus trapping
  useEffect(() => {
    const dialog = refDialog.current;
    if (!dialog) return;

    // Re-read on every Tab: dialogs add and remove controls after mount (the
    // Move dialog shows its custom-path input only for one option), and a
    // snapshot taken at mount traps against detached nodes, letting Shift+Tab
    // escape the modal onto the page behind it.
    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled')
      );

    const focusableElements = getFocusable();
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];

    // Respect an explicit focus target: this effect runs after the child's
    // commit, so blindly focusing the first element steals focus from the safe
    // default (the destructive confirm dialog marks its "No" button, and a
    // reflex Enter would otherwise hit "Yes").
    // React does NOT render an `autofocus` attribute for the autoFocus prop —
    // it only calls .focus() at mount — so a data attribute is the only
    // selector that actually matches here.
    const explicit = dialog.querySelector<HTMLElement>('[data-autofocus]');
    (explicit ?? firstElement)?.focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', handleTab);
    return () => dialog.removeEventListener('keydown', handleTab);
  }, []);

  return refDialog;
}
