import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react';
import useRootStore from '../../hooks/useRootStore';
import {
  readDiagnosticLog,
  clearDiagnosticLog,
  formatDiagnosticReport,
  type DiagnosticEntry,
} from '../../tools/diagnosticLog';

/**
 * What the extension knows about itself and the daemon, which is most of what a
 * bug report is missing. The version guards branch on RPC 16, 17 and 18, and no
 * user knows which one their daemon speaks.
 */
function useEnvironment(): string[] {
  const rootStore = useRootStore();
  // On the settings node, not the client: it is the session-get reply that
  // carries the daemon's version, and it is undefined until one has landed.
  const daemon = rootStore.client?.settings?.daemonVersionStr ?? '';

  return useMemo(() => {
    let version = '';
    try {
      version = chrome.runtime.getManifest().version;
    } catch {
      // Not reachable from an extension page, but this pane exists to report
      // failures and must not become one.
    }
    return [
      `Transmission Easy Client ${version}`.trim(),
      daemon,
      typeof navigator === 'undefined' ? '' : navigator.userAgent,
    ];
  }, [daemon]);
}

/** How long the button says it worked before going back to saying what it does. */
const COPIED_FEEDBACK_MS = 2000;

/**
 * The Diagnostics pane.
 *
 * The report is shown in full, in a plain read-only textarea, and that is the
 * point rather than a shortcut. Redaction on the way in strips the daemon host,
 * the Basic-auth header and anything shaped like a credential, but it cannot
 * recognise a torrent name inside a free-form message. Copying this text
 * publishes it — usually into a public issue — so the safeguard that actually
 * holds is that the user reads it first.
 *
 * It also means a failed clipboard write is not a dead end: the text is right
 * there to select by hand.
 */
const DiagnosticOptions = observer(() => {
  const environment = useEnvironment();
  const [entries, setEntries] = useState<DiagnosticEntry[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    readDiagnosticLog().then(setEntries);
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, [load]);

  const report = useMemo(
    () => formatDiagnosticReport(environment, entries ?? []),
    [environment, entries]
  );

  const flagCopied = useCallback((ok: boolean) => {
    setCopied(ok);
    setCopyFailed(!ok);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, COPIED_FEEDBACK_MS);
  }, []);

  const handleCopy = useCallback(() => {
    // Property access, not a rejected promise: without a clipboard object at
    // all this throws synchronously out of the handler — the lesson the magnet
    // dialog already paid for. Either way the textarea is selected so the text
    // can be taken by hand.
    if (!navigator.clipboard) {
      reportRef.current?.select();
      flagCopied(false);
      return;
    }
    navigator.clipboard.writeText(report).then(
      () => flagCopied(true),
      () => {
        reportRef.current?.select();
        flagCopied(false);
      }
    );
  }, [report, flagCopied]);

  const handleClear = useCallback(() => {
    clearDiagnosticLog().then(load);
  }, [load]);

  return (
    <div className="page diagnostic">
      <h2>{chrome.i18n.getMessage('optDiagnostic')}</h2>
      <p className="section-hint">{chrome.i18n.getMessage('diagnosticIntro')}</p>

      <textarea
        ref={reportRef}
        className="diagnostic-report"
        readOnly
        rows={16}
        value={report}
        aria-label={chrome.i18n.getMessage('optDiagnostic')}
      />

      {entries !== null && entries.length === 0 ? (
        <p className="diagnostic-empty">{chrome.i18n.getMessage('diagnosticEmpty')}</p>
      ) : null}

      <div className="diagnostic-actions">
        <button type="button" onClick={handleCopy}>
          {copied
            ? chrome.i18n.getMessage('diagnosticCopied')
            : chrome.i18n.getMessage('copy') || 'Copy'}
        </button>
        <button type="button" onClick={load}>
          {chrome.i18n.getMessage('refresh') || 'Refresh'}
        </button>
        <button type="button" onClick={handleClear}>
          {chrome.i18n.getMessage('diagnosticClear')}
        </button>
        {copyFailed ? <span className="red">{chrome.i18n.getMessage('OV_FL_ERROR')}</span> : null}
      </div>
    </div>
  );
});

export default DiagnosticOptions;
