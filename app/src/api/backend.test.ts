import { describe, expect, it } from "vitest";
import { normalizeError } from "./backend";

describe("normalizeError", () => {
  it("preserves typed frontend error policy", () => {
    expect(normalizeError({ code: "STALE_GENERATION", message: "changed", retryable: true })).toMatchObject({ code: "STALE_GENERATION", retryable: true, repo_id: null });
  });
  it("sanitizes unknown rejection shapes", () => {
    expect(normalizeError("secret raw value")).toMatchObject({ code: "IO", message: "An unexpected local operation failed", retryable: false });
  });
});
