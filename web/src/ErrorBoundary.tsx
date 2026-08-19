import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from './he';

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/**
 * Catches a render/lifecycle crash in any child so one broken component can't
 * blank the whole app (a single bad offer shape or graph edge case used to take
 * the entire screen down to a white page). The tracked data lives in the
 * server's SQLite file, so a display error never loses it — the fallback says
 * so and offers a reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('VGPT.IL render error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <p className="error-boundary-title">⚠️ {t.errorBoundaryTitle}</p>
        <p className="error-boundary-body">{t.errorBoundaryBody}</p>
        <button className="toolbtn" onClick={() => window.location.reload()}>
          {t.errorBoundaryReload}
        </button>
      </div>
    );
  }
}
