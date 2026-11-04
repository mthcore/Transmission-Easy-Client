import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../TransmissionClient');
import bgSingleton from '../Bg';

/**
 * Clicking a completion notification opens the popup, or the extension page in
 * a tab where the popup cannot be opened. Firefox's chrome.* namespace reports
 * that refusal through runtime.lastError and returns undefined, so a fallback
 * hung on a returned Promise never runs there.
 */

const bg = bgSingleton as unknown as { handleNotificationClick(id: string): void };
const action = chrome.action as unknown as { openPopup?: unknown };
const runtime = chrome.runtime as { lastError: chrome.runtime.LastError | null | undefined };

afterEach(() => {
  delete action.openPopup;
  runtime.lastError = null;
  vi.mocked(chrome.tabs.create).mockClear();
});

describe('handleNotificationClick', () => {
  it('opens the popup when the browser allows it', () => {
    action.openPopup = vi.fn((cb: () => void) => cb());
    bg.handleNotificationClick('n1');
    expect(action.openPopup).toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('falls back to a tab when the refusal comes through lastError (Firefox)', () => {
    action.openPopup = vi.fn((cb: () => void) => {
      runtime.lastError = { message: 'openPopup requires a user gesture' };
      cb();
      runtime.lastError = null;
      return undefined;
    });
    bg.handleNotificationClick('n1');
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: '/index.html' });
  });

  it('falls back to a tab when openPopup throws', () => {
    action.openPopup = vi.fn(() => {
      throw new Error('not supported');
    });
    bg.handleNotificationClick('n1');
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: '/index.html' });
  });

  it('opens a tab directly where openPopup does not exist', () => {
    bg.handleNotificationClick('n1');
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: '/index.html' });
  });
});
