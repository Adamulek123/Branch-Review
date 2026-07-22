import { render, screen } from "@testing-library/react";
import { GitBranch } from "lucide-react";
import { describe, expect, it } from "vitest";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("gives icon-only controls an accessible name and shortcut tooltip", () => {
    render(<IconButton label="Refresh repository" shortcut="Ctrl+R"><GitBranch /></IconButton>);
    const button = screen.getByRole("button", { name: "Refresh repository" });
    expect(button).toHaveAttribute("data-tooltip", "Refresh repository · Ctrl+R");
  });
});
