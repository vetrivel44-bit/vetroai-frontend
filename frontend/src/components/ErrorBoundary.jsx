import React from "react";

// Contains a render crash to the subtree it wraps, so one broken message or
// panel can't unmount the whole app and leave a blank screen.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[VetroAI] render error", error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error);
    return (
      <div role="alert" style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border, #444)", color: "var(--ink, inherit)", fontSize: 14 }}>
        This part couldn't be displayed ({error?.message || "unknown error"}).
      </div>
    );
  }
}
