import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FeedbackStatus } from "./api";
import { SnapshotFeedback } from "./components/SnapshotFeedback";

afterEach(cleanup);

const COPY = {
  question: "How useful was this experience in helping you think more clearly about your project?",
  scale_min: "Not useful",
  scale_max: "Very useful",
  comment_label: "Anything you'd like us to know?",
  optional: "Optional",
  submit: "Send feedback",
  thanks: "Thank you for your feedback.",
  rating_required: "Please choose a rating from 1 to 5.",
  error: "We couldn't save your feedback. Please try again.",
};

const status = (overrides: Partial<FeedbackStatus> = {}): FeedbackStatus => ({
  available: true,
  submitted: false,
  questionVersion: "snapshot-feedback-v1",
  copy: { en: COPY, es: { ...COPY, question: "¿Qué tan útil fue esta experiencia?", thanks: "Gracias por tus comentarios." } },
  ...overrides,
});

describe("post-Snapshot feedback", () => {
  it("is not shown until the Snapshot is available", async () => {
    const { container } = render(<SnapshotFeedback locale="en" source={{ load: async () => status({ available: false }), submit: vi.fn() }} />);
    await waitFor(() => expect(container.querySelector(".feedback")).toBeNull());
  });

  it("asks the frozen question with its 1–5 scale and an optional comment", async () => {
    const submit = vi.fn().mockResolvedValue(status({ submitted: true }));
    render(<SnapshotFeedback locale="en" source={{ load: async () => status(), submit }} />);

    expect(await screen.findByText(COPY.question)).toBeInTheDocument();
    // The ends of the scale are labelled for everyone (the hint) and for screen readers (each option).
    expect(screen.getAllByText("1 Not useful").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5 Very useful").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("radio")).toHaveLength(5);

    // A rating is required; the comment is not.
    fireEvent.click(screen.getByRole("button", { name: COPY.submit }));
    expect(await screen.findByText(COPY.rating_required)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("radio")[3] as HTMLElement);
    fireEvent.change(screen.getByLabelText(/Anything you'd like us to know/), { target: { value: "Clear and useful" } });
    fireEvent.click(screen.getByRole("button", { name: COPY.submit }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith({ usefulness: 4, comment: "Clear and useful" }));
    expect(await screen.findByText(COPY.thanks)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: COPY.submit })).toBeNull();
  });

  it("sends no comment when none is written, and shows an error without losing the answer", async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(status({ submitted: true }));
    render(<SnapshotFeedback locale="en" source={{ load: async () => status(), submit }} />);
    await screen.findByText(COPY.question);
    fireEvent.click(screen.getAllByRole("radio")[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: COPY.submit }));

    expect(await screen.findByText(COPY.error)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: COPY.submit }));
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ usefulness: 1, comment: null }));
  });

  it("shows only the thank-you once feedback has been given, in the reader's language", async () => {
    render(<SnapshotFeedback locale="es" source={{ load: async () => status({ submitted: true }), submit: vi.fn() }} />);
    expect(await screen.findByText("Gracias por tus comentarios.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});
