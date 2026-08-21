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
    const handleBodyClick = (e: MouseEvent) => {
      if (isTopmost() && refDialog.current && !refDialog.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleBodyClick);
    }, 0);
    return () => {
      clearTimeout(timeoutId);
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

    const focusableElements = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Auto-focus first element
    firstElement?.focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    dialog.addEventListener('keydown', handleTab);
    return () => dialog.removeEventListener('keydown', handleTab);
  }, []);

  return refDialog;
}
