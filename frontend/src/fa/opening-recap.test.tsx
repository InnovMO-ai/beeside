import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OpeningRecap } from "./components/OpeningRecap";
import { makeT } from "./copy";
import { TEST_BUNDLE } from "./test-fixtures";
import { RenderedSnapshot } from "./types";

const FACTS: RenderedSnapshot["facts"] = [
  { key: "company", label: "Company", value: "Acme Co", detail: null },
  { key: "market", label: "Target market", value: "Mexico", detail: null },
  { key: "launch", label: "Target launch", value: "Q1 2027", detail: null },
  { key: "priority", label: "Your immediate priority", value: "Local entity & legal setup", detail: "Within 30 days" },
];

const t = makeT(TEST_BUNDLE, "en");

describe("OpeningRecap", () => {
  it("recaps the client's own project, objectives and requirements — no decorative imagery", () => {
    render(
      <OpeningRecap
        eyebrow="Your Expansion Snapshot"
        headline="Your project, in perspective."
        generatedOn="Generated on September 17, 2026"
        summary={["Acme Co is looking to enter a new market for the first time in Mexico."]}
        facts={FACTS}
        shapePlan={{ title: "What could shape the plan", items: ["A firm launch commitment"] }}
        t={t}
      />
    );
    expect(screen.getByRole("heading", { level: 1, name: "Your project, in perspective." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Your project" })).toBeInTheDocument();
    expect(screen.getByText("Acme Co is looking to enter a new market for the first time in Mexico.")).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 2, name: "Your objectives" })).toBeInTheDocument();
    expect(screen.getByText("Q1 2027")).toBeInTheDocument();
    expect(screen.getByText("Local entity & legal setup")).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 2, name: "Your requirements" })).toBeInTheDocument();
    expect(screen.getByText("A firm launch commitment")).toBeInTheDocument();

    expect(document.querySelector("img, picture, svg image")).not.toBeInTheDocument();
  });

  it("shows a plain fallback when no requirements were declared, instead of an empty section", () => {
    render(
      <OpeningRecap
        eyebrow="Your Expansion Snapshot"
        headline="Your project, in perspective."
        generatedOn="Generated on September 17, 2026"
        summary={["Acme Co is looking to enter a new market for the first time."]}
        facts={FACTS}
        shapePlan={null}
        t={t}
      />
    );
    expect(screen.getByText("You haven’t flagged any fixed constraints or commitments yet.")).toBeInTheDocument();
  });

  it("omits the objectives beat entirely when there is no launch timing or immediate priority to show", () => {
    render(
      <OpeningRecap
        eyebrow="Your Expansion Snapshot"
        headline="Your project, in perspective."
        generatedOn="Generated on September 17, 2026"
        summary={["Acme Co is looking to enter a new market for the first time."]}
        facts={FACTS.filter((f) => f.key === "company" || f.key === "market")}
        shapePlan={null}
        t={t}
      />
    );
    expect(screen.queryByRole("heading", { level: 2, name: "Your objectives" })).not.toBeInTheDocument();
  });
});
