const { createApp } = require("./app");
const { getConfig } = require("./config/env");
const { connectDatabase, disconnectDatabase } = require("./config/database");

const { port } = getConfig();
const app = createApp();
let server;

async function startServer() {
  await connectDatabase();
  server = app.listen(port, () => {
    console.log(
      `WhatsApp Flows API listening on http://localhost:${port} (PID ${process.pid})`,
    );
  });

  server.on("error", (error) => {
    console.error("WhatsApp Flows API failed to start:", error);
    process.exitCode = 1;
  });
}

async function shutDown(signal) {
  console.log(`${signal} received; closing WhatsApp Flows API.`);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectDatabase();
  process.exit(0);
}

process.on("SIGINT", () => shutDown("SIGINT"));
process.on("SIGTERM", () => shutDown("SIGTERM"));

startServer().catch((error) => {
  console.error("Could not start WhatsApp Flows API:", error);
  process.exitCode = 1;
});
