import { useState } from 'react';
import { api } from './api';
import { t } from './he';
import { CONTACT } from './support';

/**
 * Report a bug, ask for a change, suggest a feature — without an email client.
 *
 * THE PROBLEM WITH `mailto:` is that it opens whatever the operating system
 * thinks is the mail program, which on a great many machines is nothing at
 * all, or Outlook on a person who uses Gmail in a browser. The link appears to
 * do nothing and the report is never sent.
 *
 * GitHub's issue form takes the whole thing in a URL. The user lands on a page
 * with the title and body already filled in, presses one button, and it is
 * filed — no mail client, no server of ours, and a public thread they can
 * follow rather than a message that vanishes into somebody's inbox. They do
 * need a GitHub account, which is why the mail address is still offered
 * underneath for people who would rather not.
 *
 * THE DIAGNOSTIC REPORT IS OFFERED, NEVER ATTACHED SILENTLY. It is generated
 * only if the user ticks the box, it is shown in full in the box below before
 * they submit, and it is their machine's data going to a public issue tracker.
 * Attaching it quietly would be the same mistake as a mailto that does nothing:
 * doing something the person did not understand they were doing.
 */

type Kind = 'bug' | 'idea' | 'question';

export function ContactView() {
  const [kind, setKind] = useState<Kind>('bug');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attach, setAttach] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDiagnostics = async (on: boolean) => {
    setAttach(on);
    if (!on || diag) return;
    setBusy(true);
    try {
      setDiag((await api.diagnostics()).text);
    } catch {
      setDiag(t.contactDiagFailed);
    } finally {
      setBusy(false);
    }
  };

  /** Everything the user has written, as the issue body. */
  const composed = () => {
    const parts = [body.trim()];
    if (attach && diag) {
      parts.push('', '---', '<details><summary>diagnostic report</summary>', '', '```', diag, '```', '', '</details>');
    }
    return parts.join('\n');
  };

  const issueUrl = () => {
    const url = new URL(`https://github.com/${CONTACT.repo}/issues/new`);
    url.searchParams.set('title', `[${t.contactKinds[kind]}] ${subject.trim()}`.slice(0, 200));
    url.searchParams.set('body', composed());
    url.searchParams.set('labels', kind);
    return url.href;
  };

  const mailUrl = () => {
    const url = new URL(`mailto:${CONTACT.email}`);
    url.searchParams.set('subject', `[VGPT.IL ${t.contactKinds[kind]}] ${subject.trim()}`);
    url.searchParams.set('body', composed());
    return url.href.replace(/\+/g, '%20');
  };

  const ready = subject.trim().length > 2 && body.trim().length > 5;
  // A URL that would be refused by the browser or truncated by the server.
  const tooLong = issueUrl().length > 7500;

  return (
    <section className="contact">
      <h2 className="contact-title">{t.contactTitle}</h2>
      <p className="contact-intro">{t.contactIntro}</p>

      <div className="contact-kinds">
        {(['bug', 'idea', 'question'] as Kind[]).map((k) => (
          <button
            key={k}
            className={`contact-kind ${kind === k ? 'on' : ''}`}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {t.contactKinds[k]}
          </button>
        ))}
      </div>
      <p className="contact-hint">{t.contactKindHints[kind]}</p>

      <label className="contact-field">
        <span className="cur-label">{t.contactSubject}</span>
        <input
          className="pref-select contact-input"
          value={subject}
          maxLength={120}
          placeholder={t.contactSubjectPlaceholder[kind]}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>

      <label className="contact-field">
        <span className="cur-label">{t.contactBody}</span>
        <textarea
          className="contact-body"
          value={body}
          maxLength={4000}
          placeholder={t.contactBodyPlaceholder[kind]}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>

      <label className="check-row" title={t.contactAttachHint}>
        <input type="checkbox" checked={attach} onChange={(e) => void loadDiagnostics(e.target.checked)} />
        {busy ? t.contactAttachLoading : t.contactAttach}
      </label>

      {attach && diag && (
        <>
          <p className="contact-diag-note">{t.contactDiagNote}</p>
          <textarea className="diag-out" readOnly value={diag} spellCheck={false} dir="ltr" />
        </>
      )}

      {tooLong && <p className="contact-warn">{t.contactTooLong}</p>}

      <div className="contact-send">
        <a
          className={`contact-go ${ready && !tooLong ? '' : 'off'}`}
          href={ready && !tooLong ? issueUrl() : undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!ready || tooLong}
          onClick={(e) => {
            if (!ready || tooLong) e.preventDefault();
          }}
        >
          {t.contactViaGithub}
        </a>
        <a
          className={`contact-alt ${ready ? '' : 'off'}`}
          href={ready ? mailUrl() : undefined}
          aria-disabled={!ready}
          onClick={(e) => {
            if (!ready) e.preventDefault();
          }}
        >
          {t.contactViaMail}
        </a>
      </div>
      <p className="contact-note">{ready ? t.contactReady : t.contactNeedMore}</p>
      <p className="contact-note">{t.contactPublicNote}</p>
    </section>
  );
}
