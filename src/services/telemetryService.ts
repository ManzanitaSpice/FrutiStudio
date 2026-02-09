import { loadConfig } from "./configService";

export const sendTelemetry = async (event: string, payload: object) => {
  const config = await loadConfig();
  if (!config.telemetryOptIn) {
    return;
  }
  await fetch("https://telemetry.frutistudio.local/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, payload }),
  });
};
