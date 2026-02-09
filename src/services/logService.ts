import { invokeWithHandling } from "./tauriClient";
import { formatIsoTimestamp } from "../utils/formatters";

export type LogScope = "instances" | "downloads";
export type LogLevel = "info" | "warn" | "error";

const buffer: string[] = [];
let flushTimer: number | null = null;

const flushBuffer = async (scope: LogScope) => {
  const payload = buffer.splice(0, buffer.length);
  if (!payload.length) {
    return;
  }
  await invokeWithHandling<void>("append_log", { scope, lines: payload });
};

export const logMessage = async (
  scope: LogScope,
  level: LogLevel,
  message: string,
  { flush = false } = {},
) => {
  const line = `[${formatIsoTimestamp()}] [${level}] ${message}`;
  buffer.push(line);

  if (flush) {
    await flushBuffer(scope);
    return;
  }

  if (flushTimer) {
    return;
  }

  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushBuffer(scope);
  }, 400);
};
