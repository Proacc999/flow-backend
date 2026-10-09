const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");
const { getConfig } = require("./config/env");
const flowRoutes = require("./routes/flow.routes");
const { errorHandler } = require("./middleware/error-handler");

function createApp() {
  const app = express();
  const { clientOrigins } = getConfig();

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    console.log(`[API] ${req.method} ${req.originalUrl}`);
    next();
  });
  app.use(helmet());
  app.use(
    cors({
      exposedHeaders: ["Content-Disposition"],
      origin(origin, callback) {
        if (!origin || clientOrigins.includes("*") || clientOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
      },
    }),
  );
  app.use(express.json({ limit: "11mb" }));

  app.get("/api/health", (req, res) => {
    res.json({
      success: true,
      service: "whatsapp-flows-api",
      database:
        mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    });
  });

  app.use("/api/whatsapp", flowRoutes);



  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "API route not found." },
    });
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
