import { Component, type ErrorInfo, type ReactNode } from "react";
import { report } from "../errors";

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the page id) clears a previous error. */
  resetKey: string;
}

interface State {
  failed: boolean;
  resetKey: string;
}

/** Keeps one broken page from blanking the whole app; the error is logged. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    report(`${error.name}: ${error.message}\n${info.componentStack ?? ""}`, "render");
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="card placeholder" role="alert" data-error-boundary>
        <span className="pill pill--danger">Something went wrong</span>
        <p>
          This page hit a problem and has been logged. The rest of Life OS still works. If it keeps
          happening, copy the diagnostics from Settings.
        </p>
        <button
          type="button"
          className="button"
          onClick={() => {
            this.setState({ failed: false });
          }}
        >
          Try again
        </button>
      </section>
    );
  }
}
