import {
  ASSESSMENT_STATES,
  SUBSCRIPTION_EVENT_TYPES,
} from "./index";

describe("canonical field registry (Phase 1 skeleton)", () => {
  it("does not include PRECISION_STARTED as an assessment_state value", () => {
    // Regression test for the exact defect Technical Change Note v1.1 corrected:
    // PRECISION_STARTED must never again be representable as an assessment_state.
    expect(ASSESSMENT_STATES).not.toContain("PRECISION_STARTED");
  });

  it("fixes assessment_state to exactly the five frozen values", () => {
    expect([...ASSESSMENT_STATES].sort()).toEqual(
      ["COMPLETED_LOCKED", "DELETED", "DRAFT", "EXPIRED", "IN_PROGRESS"].sort()
    );
  });

  it("fixes the subscription event contract to exactly the four frozen event types", () => {
    expect([...SUBSCRIPTION_EVENT_TYPES].sort()).toEqual(
      [
        "cancellation_requested",
        "premium_activated",
        "premium_reactivated",
        "subscription_period_ended",
      ].sort()
    );
  });
});
