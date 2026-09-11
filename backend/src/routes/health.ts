import { Router, Request, Response } from "express";

/**
 * Phase 1 health-check endpoint.
 *
 * Deliberately minimal: this route exists so the CI/CD pipeline (Phase 1
 * acceptance criteria — Build Plan v1.1 FINAL §Phase 1) has something real to
 * build, test, and deploy to all three environments before any product logic
 * exists. It reports process liveness only — it does not touch the database,
 * since Phase 2 has not created the schema yet.
 */
export const healthRouter = Router();

export interface HealthResponse {
  status: "ok";
  service: "beeside-backend";
  environment: string;
  timestamp: string;
}

healthRouter.get("/health", (_req: Request, res: Response<HealthResponse>) => {
  res.status(200).json({
    status: "ok",
    service: "beeside-backend",
    environment: process.env.NODE_ENV ?? "unknown",
    timestamp: new Date().toISOString(),
  });
});
