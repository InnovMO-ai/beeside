import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPoolDb } from "../../../db/database";
import { discoveryBridgeConformance } from "../../../__tests__/helpers/discovery-bridge-conformance";
import { setupPrecisionFixture } from "../../../__tests__/helpers/precision-fixtures";
import { databaseUrl, describeWithDb } from "../../../__integration__/fa-harness";
import { FixtureFaContextReader } from "../../adapters/fixture-fa-context";
import type { FaClientSafeContext } from "../../ports/fa-context";

const context = (company: string): FaClientSafeContext => ({
  project: { destinationCountry: "Mexico, Spain", sector: "Food and beverage", expansionObjective: "Open a distribution hub for our retail line", timeframe: "2027-04" },
  company: { displayName: company, operatingCountries: ["CL"] },
  needs: [{ capabilityId: "logistics", label: "Logistics", priority: "high" }],
  literals: { motive: "We want to grow." },
  locale: "en",
});

describeWithDb("Discovery → Precision bridge (fixture reader, PostgreSQL)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 4 }); });
  afterAll(() => pool.end());

  discoveryBridgeConformance("fixture reader", async () => {
    const db = createPoolDb(pool);
    const fx = await setupPrecisionFixture(db);
    const { projectId } = await fx.newProject("Bridge");
    const reader = new FixtureFaContextReader([{ projectId, resultId: randomUUID(), context: context("Northwind Foods") }]);
    return { db, reader, projectId, redeliver: () => reader.add({ projectId, resultId: randomUUID(), context: context("Northwind Foods") }) };
  });
});
