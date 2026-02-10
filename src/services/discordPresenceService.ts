import { invokeWithHandling } from "./tauriClient";

export interface DiscordActivityPayload {
  details?: string;
  state?: string;
  largeImageKey?: string;
  largeImageText?: string;
  startTimestamp?: number;
}

let activeClientId: string | null = null;
export const DISCORD_PRESENCE_ENABLED = false;

export const initDiscordPresence = async (clientId: string) => {
  if (!DISCORD_PRESENCE_ENABLED) {
    return;
  }
  if (!clientId) {
    return;
  }
  if (activeClientId === clientId) {
    return;
  }
  await invokeWithHandling<void>("init_discord_rpc", { clientId });
  activeClientId = clientId;
};

export const setDiscordActivity = async (activity: DiscordActivityPayload) =>
  DISCORD_PRESENCE_ENABLED
    ? invokeWithHandling<void>("set_discord_activity", { activity })
    : Promise.resolve();

export const clearDiscordActivity = async () =>
  DISCORD_PRESENCE_ENABLED
    ? invokeWithHandling<void>("clear_discord_activity")
    : Promise.resolve();
