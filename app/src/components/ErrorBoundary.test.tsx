import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Broken(): never {
  throw new Error("renderer failed");
}

describe("ErrorBoundary", () => {
  it("keeps a renderer exception inside a recoverable fallback", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ErrorBoundary><Broken /></ErrorBoundary>);
    expect(screen.getByText("The renderer encountered an error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try rendering again" })).toBeInTheDocument();
    log.mockRestore();
  });

  it("resets a local failure when the selected file changes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(<ErrorBoundary resetKey="old" fallback={() => <span>Failed diff</span>}><Broken /></ErrorBoundary>);
    expect(screen.getByText("Failed diff")).toBeInTheDocument();
    view.rerender(<ErrorBoundary resetKey="new" fallback={() => <span>Failed diff</span>}><span>New file rendered</span></ErrorBoundary>);
    await waitFor(() => expect(screen.getByText("New file rendered")).toBeInTheDocument());
    log.mockRestore();
  });
});
