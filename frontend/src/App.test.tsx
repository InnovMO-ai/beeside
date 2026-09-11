import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App } from "./App";

describe("Phase 1 placeholder shell", () => {
  it("renders without crashing so the build/deploy pipeline has a real artifact to ship", () => {
    render(<App />);
    expect(screen.getByTestId("phase1-placeholder")).toBeInTheDocument();
  });
});
