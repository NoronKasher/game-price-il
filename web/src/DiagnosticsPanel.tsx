import { useState } from 'react';
import { api } from './api';
import { t } from './he';

/**
 * "Export what is going wrong, so somebody can read it."
 *
 * Describing a bug costs an enormous amount of back-and-forth: which sources
 * answered, what each returned, which grouping decision merged or split two
 * titles, what the browser is. All of that is knowable inside the tool in one
 * click and nearly unknowable outside it.
 *
 * THE SEARCH FIELD IS THE POINT, not an extra. A report with no search sample
 * says "a source is down", which is worth something. A report WITH one says
 * exactly which two titles were grouped under which keys — which is the whole
 * answer to "why does this game appear twice", and is otherwise a conversation.
 *
 * What it never contains is listed for the user before they export, because a
 * file people send to strangers has to be a file they can read first. That
 * promise is kept in server/src/diagnostics.ts, not here.
 */

export function DiagnosticsPanel() {
  const [query, setQuery] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setBusy(true);
    setCopied(false);
    try {
      const r = await api.diagnostics(query.trim() || undefined);
      setText(r.text);
    } catch {
      setText(t.diagFailed);
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!text) return;
    // A Blob rather than a data: URL — a report with a long search sample can
    // exceed what some browsers accept in an href.
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `vgpt-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <h2 className="settings-section">{t.diagTitle}</h2>

      <div className="diag-howto">
        <h3 className="diag-howto-title">{t.diagHowtoTitle}</h3>
        <ol className="diag-steps">
          {t.diagSteps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <p className="diag-privacy">{t.diagPrivacy}</p>
      </div>

      <div className="diag-run">
        <label className="diag-field">
          <span className="cur-label">{t.diagQueryLabel}</span>
          <input
            className="pref-select diag-input"
            value={query}
            placeholder={t.diagQueryPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
            }}
          />
        </label>
        <button className="diag-go" onClick={() => void run()} disabled={busy}>
          {busy ? t.diagRunning : t.diagRun}
        </button>
      </div>

      {text && (
        <>
          <div className="diag-actions">
            <button
              className="diag-copy"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  setCopied(true);
                } catch {
                  // Clipboard permission can be refused; the textarea below is
                  // selectable, so this is a convenience and never the only way.
                  setCopied(false);
                }
              }}
            >
              {copied ? t.diagCopied : t.diagCopy}
            </button>
            <button className="diag-download" onClick={download}>
              {t.diagDownload}
            </button>
            <span className="diag-size">{t.diagSize(Math.ceil(text.length / 1024))}</span>
          </div>
          <textarea className="diag-out" readOnly value={text} spellCheck={false} dir="ltr" />
        </>
      )}
    </>
  );
}
