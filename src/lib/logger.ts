/**
 * Crypto Vision — Logger
 * Structured JSON logging via pino
 *
 * Base context includes service name, instance ID (for multi-instance tracing),
 * and app version. In production, every log line is a JSON object that
 * Cloud Logging / Datadog / ELK can index and correlate automatically.
 */

import pino from "pino";
import { randomUUID } from "node:crypto";

/** Stable instance ID — persists for the lifetime of this process / container */
export const INSTANCE_ID = process.env.K_REVISION
  ? `${process.env.K_REVISION}-${randomUUID().slice(0, 8)}`
  : randomUUID().slice(0, 8);

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  base: {
    service: "crypto-vision",
    instance: INSTANCE_ID,
    env: process.env.NODE_ENV || "development",
  },
  // Redact sensitive fields from accidental logging
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers[\"x-api-key\"]",
      "apiKey",
      "password",
      "secret",
      "token",
    ],
    censor: "[REDACTED]",
  },
});

/** Alias for convenience — many modules import `{ log }` */
export const log = logger;
