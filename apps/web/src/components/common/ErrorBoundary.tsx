import { ActionButton } from "@/components/ui/action-button";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: string | null };
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Avoid logging stream URLs or Worker access tokens from component stacks.
    console.error(
      "YouTV component error",
      error.name,
      info.componentStack?.slice(0, 300),
    );
  }
  render() {
    if (this.state.error)
      return (
        <main className="empty-state" role="alert">
          <AlertTriangle size={40} />
          <h2>YouTV encountered an unexpected error</h2>
          <p>Refresh the app. Your locally saved channels are not deleted.</p>
          <ActionButton
            className="ui-button ui-button-primary ui-button-normal"
            onClick={() => window.location.reload()}
          >
            Reload YouTV
          </ActionButton>
        </main>
      );
    return this.props.children;
  }
}
