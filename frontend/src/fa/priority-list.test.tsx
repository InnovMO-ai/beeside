import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PriorityList } from "./components/PriorityList";
import { RenderedNeedsPriority } from "./types";

const ITEMS: RenderedNeedsPriority[] = [
  {
    key: "company_setup",
    label: "Company Setup",
    isImmediatePriority: true,
    isBlocker: true,
    dependsOnLabel: null,
    owner: "Ana Rivera",
    approvalRequired: false,
    approvalFrom: null,
  },
  {
    key: "tax",
    label: "Tax",
    isImmediatePriority: false,
    isBlocker: false,
    dependsOnLabel: "Company Setup",
    owner: null,
    approvalRequired: true,
    approvalFrom: "Finance lead",
  },
];

const PRIORITIES = {
  title: "What matters now",
  intro: "Your declared priorities, with the dependencies and approvals they involve.",
  immediateLabel: "Immediate priority",
  nextLabel: "Next priorities",
  blockerLabel: "Blocker",
  dependsOnLabel: "Depends on",
  ownerLabel: "Internal owner",
  approvalLabel: "Needs approval from",
  items: ITEMS,
};

afterEach(() => {
  cleanup();
});

describe("PriorityList", () => {
  it("keeps the declared order and labels each item's own status without reordering anything", () => {
    render(<PriorityList priorities={PRIORITIES} />);
    expect(screen.getByRole("heading", { level: 2, name: "What matters now" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Company Setup");
    expect(items[0]).toHaveTextContent("Immediate priority");
    expect(items[0]).toHaveTextContent("Blocker");
    expect(items[1]).toHaveTextContent("Tax");
    expect(items[1]).toHaveTextContent("Next priorities");
  });

  it("shows dependency, owner and approval as labeled metadata, never folded into the ordering", () => {
    const { container } = render(<PriorityList priorities={PRIORITIES} />);
    const rows = container.querySelectorAll(".priority-item-meta-row");
    expect(rows).toHaveLength(3); // item 0: owner only; item 1: depends-on + approval
    expect(screen.getByText("Ana Rivera")).toBeInTheDocument();
    expect(screen.getByText("Finance lead")).toBeInTheDocument();
  });

  it("renders nothing when there are no priorities to show", () => {
    const { container } = render(<PriorityList priorities={{ ...PRIORITIES, items: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
