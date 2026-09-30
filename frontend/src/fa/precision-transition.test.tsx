import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PrecisionTransition } from "./components/PrecisionTransition";
import { makeT } from "./copy";
import { TEST_BUNDLE } from "./test-fixtures";

const t = makeT(TEST_BUNDLE, "en");

describe("PrecisionTransition", () => {
  it("sets expectations for what's next (frozen v8.1 3-icon grid) without any price or purchase wording", () => {
    render(<PrecisionTransition t={t} />);
    expect(screen.getByRole("heading", { level: 2, name: "What's next" })).toBeInTheDocument();
    expect(
      screen.getByText("With Precision Assessment, your identified needs become clear, service ready requirements."),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$|price|buy|purchase/i);
  });
});
