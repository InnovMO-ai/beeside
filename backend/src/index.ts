import express from "express";
import { healthRouter } from "./routes/health";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);
  return app;
}

/* istanbul ignore next -- exercised by real deployment, not unit tests */
if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`beeside backend listening on :${port}`);
  });
}
