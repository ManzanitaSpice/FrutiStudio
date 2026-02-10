import { apiFetch } from "./apiClients/client";

export interface ServerListing {
  id: string;
  name: string;
  ip: string;
  status: string;
  players: string;
  tags: string[];
  website: string;
  official: boolean;
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
    id: "hypixel",
    name: "Hypixel",
    ip: "mc.hypixel.net",
    tags: ["Minijuegos", "Competitivo"],
    website: "https://hypixel.net",
    official: true,
  },
  {
    id: "cubecraft",
    name: "CubeCraft",
    ip: "play.cubecraft.net",
    tags: ["Skyblock", "Minijuegos"],
    website: "https://www.cubecraft.net",
    official: true,
  },
  {
    id: "mccentral",
    name: "MC Central",
    ip: "play.mccentral.org",
    tags: ["Survival", "Skyblock"],
    website: "https://www.mccentral.org",
    official: true,
  },
  {
    id: "gommehd",
    name: "GommeHD",
    ip: "gommehd.net",
    tags: ["PvP", "Minijuegos"],
    website: "https://www.gommehd.net",
    official: true,
  },
];

const communityServers = [
  {
    id: "wynncraft",
    name: "Wynncraft",
    ip: "play.wynncraft.com",
    tags: ["RPG", "Cooperativo"],
    website: "https://wynncraft.com",
    official: false,
  },
  {
    id: "mineplex",
    name: "Mineplex",
    ip: "us.mineplex.com",
    tags: ["Minijuegos", "Casual"],
    website: "https://www.mineplex.com",
    official: false,
  },
  {
    id: "complex-gaming",
    name: "Complex Gaming",
    ip: "hub.mc-complex.com",
    tags: ["Modpacks", "Skyblock"],
    website: "https://www.mc-complex.com",
    official: false,
  },
];

const buildStatusUrl = (ip: string) => `${STATUS_BASE}/${ip}`;

export const fetchServerListings = async (): Promise<ServerListing[]> => {
  const servers = [...officialServers, ...communityServers];
  const results = await Promise.all(
    servers.map(async (server) => {
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
        official: server.official,
        status: data.online ? "Online" : "Offline",
        players: data.online
          ? `${playersOnline} / ${playersMax}`
          : "Sin datos",
      };
    }),
  );

  return results;
};
