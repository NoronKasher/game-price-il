import { useState } from 'react';
import { api } from './api';
import { nis, t } from './he';
import type { AdvisorStep, GenreAffinity, Suggestion } from './types';

/**
 * ALPHA — "given what you actually play, is this one for you?"
 *
 * THE WARNING IS NOT DECORATION. A recommender that guesses badly spends the
 * trust the price board earns by being exact, and this one is a weak,
 * explainable heuristic: genre affinity weighted by hours played. It says so at
 * the top, it says every suggestion's reasoning in words, and it says what it
 * cannot know.
 *
 * WHAT IT CANNOT KNOW, stated because burying it would be the dishonest part:
 * whether you LIKED any of it. Steam has no API for a person's own reviews and
 * the profile page listing them is login-gated, so playtime stands in for
 * liking. Two hundred hours is treated as an opinion — usually true, and
 * plainly wrong for the game somebody bounced off after grinding.
 *
 * Suggestions come from the DEALS feed rather than the whole catalogue, which
 * is a deliberate narrowing: a price tracker naming a full-price game you
 * cannot afford is a magazine.
 */

export function AdvisorView() {
  const [profile, setProfile] = useState('');
  const [step, setStep] = useState<AdvisorStep | null>(null);
  const [affinity, setAffinity] = useState<GenreAffinity[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!profile.trim() || running) return;
    setRunning(true);
    setError(null);
    setSuggestions(null);
    setAffinity([]);
    try {
      const final = await api.advisor(profile.trim(), (s) => {
        setStep(s);
        if (s.type === 'affinity' && s.affinity) setAffinity(s.affinity);
      });
      if (!final || final.type === 'error') setError(final?.reason ?? 'failed');
      else setSuggestions(final.suggestions ?? []);
    } catch {
      setError('failed');
    } finally {
      setRunning(false);
      setStep(null);
    }
  };

  return (
    <section className="advisor">
      <h2 className="advisor-title">
        {t.advisorTitle} <span className="advisor-alpha">{t.advisorAlpha}</span>
      </h2>
      <p className="advisor-warn">{t.advisorWarning}</p>
      <p className="advisor-intro">{t.advisorIntro}</p>

      <div className="advisor-run">
        <label className="contact-field advisor-field">
          <span className="cur-label">{t.advisorProfileLabel}</span>
          <input
            className="pref-select contact-input"
            value={profile}
            placeholder={t.advisorProfilePlaceholder}
            onChange={(e) => setProfile(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
            }}
          />
        </label>
        <button className="diag-go" onClick={() => void run()} disabled={running || !profile.trim()}>
          {running ? t.advisorRunning : t.advisorRun}
        </button>
      </div>
      <p className="advisor-keynote">{t.advisorKeyNote}</p>

      {/* A wait of tens of seconds needs to say what it is doing. */}
      {running && step && (
        <p className="advisor-progress">
          {step.type === 'library' && t.advisorFoundLibrary(step.games ?? 0)}
          {step.type === 'profiling' && t.advisorProfiling(step.done ?? 0, step.total ?? 0, step.title ?? '')}
          {step.type === 'scoring' && t.advisorScoring(step.done ?? 0, step.total ?? 0)}
        </p>
      )}

      {error && <p className="advisor-error">{t.advisorErrors[error] ?? t.advisorErrors.failed}</p>}

      {affinity.length > 0 && (
        <div className="advisor-taste">
          <h3 className="advisor-sub">{t.advisorTasteTitle}</h3>
          <ul className="advisor-genres">
            {affinity.map((a) => (
              <li key={a.genre}>
                <span className="advisor-genre">{a.genre}</span>
                <span className="advisor-hours">{t.advisorHours(Math.round(a.hours), a.games)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestions && suggestions.length === 0 && <p className="advisor-none">{t.advisorNone}</p>}

      {suggestions && suggestions.length > 0 && (
        <>
          <h3 className="advisor-sub">{t.advisorPicksTitle}</h3>
          <ul className="advisor-picks">
            {suggestions.map((s) => (
              <li key={s.appId} className="advisor-pick">
                <div className="advisor-pick-head">
                  <span className="advisor-pick-title">{s.title}</span>
                  {s.salePriceILS != null && <span className="advisor-pick-price">{nis(s.salePriceILS)}</span>}
                  {s.savings ? <span className="deal-card-pct">{s.savings}%-</span> : null}
                </div>
                {/* The reasoning, so the user can disagree with it rather than
                    believe or dismiss a bare number. */}
                <ul className="advisor-because">
                  {s.because.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="advisor-foot">{t.advisorFoot}</p>
        </>
      )}
    </section>
  );
}
