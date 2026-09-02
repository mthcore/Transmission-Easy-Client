import showError from './showError';

/**
 * Surfaces a failure from a fire-and-forget client action.
 *
 * Menu items, keyboard shortcuts and the speed menus all dispatch RPCs whose
 * promise nobody awaits; without this a daemon failure was an unhandled
 * rejection and the user just saw the action silently not happen.
 */
export default function reportAction(action: Promise<unknown> | undefined): void {
  action?.catch((err) => {
    showError(chrome.i18n.getMessage('OV_FL_ERROR') || 'Action failed', err as Error);
  });
}
