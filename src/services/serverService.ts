import { apiFetch } from "./apiClients/client";

export interface ServerListing {
  id: string;
  name: string;
  ip: string;
  status: string;
  players: string;
  tags: string[];
  website: string;
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

const officialServers = [
  {
    id: "jartex",
    name: "Jartex",
    ip: "play.jartexnetwork.com",
    tags: ["PvP", "BedWars"],
    website: "https://jartexnetwork.com",
  },
  {
    id: "mineclub",
    name: "MineClub",
    ip: "play.mineclub.com",
    tags: ["Survival", "Roleplay"],
    website: "https://mineclub.com",
  },
  {
    id: "hypixel",
    name: "Hypixel",
    ip: "mc.hypixel.net",
    tags: ["Minijuegos", "Competitivo"],
    website: "https://hypixel.net",
  },
  {
    id: "cubecraft",
    name: "CubeCraft",
    ip: "play.cubecraft.net",
    tags: ["Skyblock", "Minijuegos"],
    website: "https://www.cubecraft.net",
  },
  {
    id: "mccentral",
    name: "MC Central",
    ip: "play.mccentral.org",
    tags: ["Survival", "Skyblock"],
    website: "https://www.mccentral.org",
  },
  {
    id: "gommehd",
    name: "GommeHD",
    ip: "gommehd.net",
    tags: ["PvP", "Minijuegos"],
    website: "https://www.gommehd.net",
  },
];

const buildStatusUrl = (ip: string) => `${STATUS_BASE}/${ip}`;

export const fetchServerListings = async (): Promise<ServerListing[]> => {
  const results = await Promise.allSettled(
    officialServers.map(async (server) => {
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
        status: data.online ? "Online" : "Offline",
        players: data.online
          ? `${playersOnline} / ${playersMax}`
          : "Sin datos",
      };
    }),
  );

  return results
    .filter((result): result is PromiseFulfilledResult<ServerListing> => result.status === "fulfilled")
    .map((result) => result.value)
    .sort((a, b) => b.players.localeCompare(a.players));
};
