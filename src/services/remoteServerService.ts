import { apiFetch } from "./apiClients/client";
import { sponsoredServers } from "./serverCatalog";

export interface RemoteServerListing {
  id: string;
  name: string;
  ip: string;
  status: string;
  players: string;
  tags: string[];
  website: string;
  description: string;
  version: string;
  serverType: string;
  banner: string;
}

interface McStatusResponse {
  online: boolean;
  players?: {
    online?: number;
    max?: number;
  };
  version?: {
    name_clean?: string;
  };
}

const STATUS_BASE = "https://api.mcstatus.io/v2/status/java";

const buildStatusUrl = (ip: string) => `${STATUS_BASE}/${ip}`;

export const fetchRemoteServerListings = async (): Promise<RemoteServerListing[]> => {
  const results = await Promise.allSettled(
    sponsoredServers.map(async (server) => {
      const data = await apiFetch<McStatusResponse>(buildStatusUrl(server.ip), {
        ttl: 60_000,
      });
      const playersOnline = data.players?.online ?? 0;
      const playersMax = data.players?.max ?? 0;
      return {
        id: server.id,
        name: server.name,
        ip: server.ip,
        tags: server.tags,
        website: server.website,
        description: server.description,
        serverType: server.serverType,
        banner: server.banner,
        version: data.version?.name_clean ?? "N/D",
        status: data.online ? "Online" : "Offline",
        players: data.online ? `${playersOnline} / ${playersMax}` : "Sin datos",
      } satisfies RemoteServerListing;
    }),
  );

  return results
    .filter(
      (result): result is PromiseFulfilledResult<RemoteServerListing> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .sort((a, b) => {
      const left = Number(a.players.split("/")[0]?.trim() ?? "0");
      const right = Number(b.players.split("/")[0]?.trim() ?? "0");
      return right - left;
    });
};
