import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HowBeesideWorks } from "./components/HowBeesideWorks";
import { makeT } from "./copy";
import { TEST_BUNDLE } from "./test-fixtures";

const t = makeT(TEST_BUNDLE, "en");

describe("HowBeesideWorks", () => {
  it("describes the working relationship, not a list of providers or capabilities", () => {
    render(<HowBeesideWorks t={t} />);
    expect(screen.getByRole("heading", { level: 2, name: "How beeside works with you" })).toBeInTheDocument();
    expect(screen.getByText("A single point of contact guides your project end to end.")).toBeInTheDocument();
  });
});
