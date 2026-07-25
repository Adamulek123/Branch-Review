import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ChangeKind } from "../api/types";
import { FileStatusIcon } from "./FileStatusIcon";

const cases: Array<[ChangeKind, string, string]> = [
  ["added", "Added", "status-added"],
  ["untracked", "Untracked", "status-added"],
  ["modified", "Modified", "status-modified"],
  ["type_changed", "Type changed", "status-modified"],
  ["unknown", "Unknown", "status-modified"],
  ["deleted", "Deleted", "status-deleted"],
  ["renamed", "Renamed", "status-renamed"],
  ["copied", "Copied", "status-renamed"],
  ["unmerged", "Unmerged", "status-conflicted"],
];

afterEach(cleanup);

describe("FileStatusIcon", () => {
  it.each(cases)("renders %s with a semantic label and color group", (status, label, colorClass) => {
    render(<FileStatusIcon status={status} />);
    expect(screen.getByRole("img", { name: label })).toHaveClass("file-status-icon", colorClass);
  });

  it("can be decorative when nearby text already names the status", () => {
    const { container } = render(<FileStatusIcon status="added" decorative />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
