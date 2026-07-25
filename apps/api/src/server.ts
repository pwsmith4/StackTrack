import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const app = createApp();

try {
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`StackTrack API listening on port ${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

