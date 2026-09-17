import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PrecisionTransition } from "./components/PrecisionTransition";
import { makeT } from "./copy";
import { TEST_BUNDLE } from "./test-fixtures";

const t = makeT(TEST_BUNDLE, "en");

describe("PrecisionTransition", () => {
  it("sets expectations for Precision Assessment without any price or purchase wording", () => {
    render(<PrecisionTransition t={t} />);
    expect(screen.getByRole("heading", { level: 2, name: "What to expect in Precision Assessment" })).toBeInTheDocument();
    expect(screen.getByText("A dedicated specialist reviews your project in detail.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$|price|buy|purchase/i);
  });
});
