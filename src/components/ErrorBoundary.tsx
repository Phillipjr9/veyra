import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Last resort: a render crash must never leave the iframe looking empty. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[veyra] render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", padding: "40px 8vw", background: "#f5f2eb", color: "#18171d", fontFamily: "sans-serif" }}>
        <p style={{ letterSpacing: "1.6px", fontSize: 11, color: "#645879" }}>VEYRA</p>
        <h1 style={{ fontSize: 32, fontWeight: 500 }}>This screen hit an error.</h1>
        <pre style={{ whiteSpace: "pre-wrap", color: "#6d2038", fontSize: 13 }}>{this.state.error.message}{"\n"}{this.state.error.stack}</pre>
      </div>
    );
  }
}
