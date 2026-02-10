import { apiFetch } from "./apiClients/client";

export interface ServerListing {
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

const officialServers = [
  {
    id: "hypixel",
    name: "Hypixel",
    ip: "mc.hypixel.net",
    tags: ["Minijuegos", "Competitivo", "SkyBlock"],
    website: "https://hypixel.net",
    description: "Red masiva con SkyBlock, BedWars y duelos.",
    serverType: "Minijuegos",
    banner: "https://eu.mc-api.net/v3/server/favicon/mc.hypixel.net",
  },
  {
    id: "cubecraft",
    name: "CubeCraft",
    ip: "play.cubecraft.net",
    tags: ["SkyBlock", "Minijuegos"],
    website: "https://www.cubecraft.net",
    description: "Servidor internacional con modos rápidos y competitivos.",
    serverType: "Minijuegos",
    banner: "https://eu.mc-api.net/v3/server/favicon/play.cubecraft.net",
  },
  {
    id: "mccentral",
    name: "MCCentral",
    ip: "play.mccentral.org",
    tags: ["Survival", "SkyBlock"],
    website: "https://www.mccentral.org",
    description: "Comunidad clásica orientada a Survival y economía.",
    serverType: "Survival",
    banner: "https://eu.mc-api.net/v3/server/favicon/play.mccentral.org",
  },
  {
    id: "complex",
    name: "Complex Gaming",
    ip: "hub.mc-complex.com",
    tags: ["Pixelmon", "Survival"],
    website: "https://mc-complex.com",
    description: "Especializado en Pixelmon y mundos temáticos.",
    serverType: "Modded",
    banner: "https://eu.mc-api.net/v3/server/favicon/hub.mc-complex.com",
  },
  {
    id: "insanitycraft",
    name: "InsanityCraft",
    ip: "play.insanitycraft.net",
    tags: ["Survival", "Facciones"],
    website: "https://insanitycraft.net",
    description: "Servidor activo con survival competitivo y facciones.",
    serverType: "Survival",
    banner: "https://eu.mc-api.net/v3/server/favicon/play.insanitycraft.net",
  },
  {
    id: "manacube",
    name: "ManaCube",
    ip: "play.manacube.com",
    tags: ["Parkour", "Skyblock", "PvP"],
    website: "https://manacube.com",
    description: "Uno de los hubs más populares para parkour y skyblock.",
    serverType: "Minijuegos",
    banner: "https://eu.mc-api.net/v3/server/favicon/play.manacube.com",
  },
  {
    id: "jartex",
    name: "JartexNetwork",
    ip: "play.jartexnetwork.com",
    tags: ["PvP", "BedWars"],
    website: "https://jartexnetwork.com",
    description: "PvP competitivo con modos de batalla y eventos.",
    serverType: "PvP",
    banner: "https://eu.mc-api.net/v3/server/favicon/play.jartexnetwork.com",
  },
  {
    id: "mineclub",
    name: "MineClub",
    ip: "play.mineclub.com",
    tags: ["Survival", "Roleplay"],
    website: "https://mineclub.com",
    description: "Servidor social con enfoque en roleplay y progresión.",
    serverType: "Roleplay",
    banner: "https://eu.mc-api.net/v3/server/favicon/play.mineclub.com",
  },
  {
    id: "pika",
    name: "PikaNetwork",
    ip: "play.pika-network.net",
    tags: ["Prison", "SkyBlock", "PvP"],
    website: "https://pika-network.net",
    description: "Red variada con Prison, SkyBlock y BedWars.",
    serverType: "Multimodo",
    banner: "https://eu.mc-api.net/v3/server/favicon/play.pika-network.net",
  },
  {
    id: "purpleprison",
    name: "Purple Prison",
    ip: "purpleprison.net",
    tags: ["Prison", "Economía"],
    website: "https://purpleprison.org",
    description: "Servidor prison centrado en economía y comercio.",
    serverType: "Prison",
    banner: "https://eu.mc-api.net/v3/server/favicon/purpleprison.net",
  },
];

const buildStatusUrl = (ip: string) => `${STATUS_BASE}/${ip}`;

export interface ServerListingResult {
  items: ServerListing[];
  total: number;
  page: number;
  hasMore: boolean;
}

export const fetchServerListings = async (page = 0, pageSize = 8): Promise<ServerListingResult> => {
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
        description: server.description,
        serverType: server.serverType,
        banner: server.banner,
        version: data.version?.name_clean ?? "N/D",
        status: data.online ? "Online" : "Offline",
        players: data.online ? `${playersOnline} / ${playersMax}` : "Sin datos",
      };
    }),
  );

  const catalog = results
    .filter(
      (result): result is PromiseFulfilledResult<ServerListing> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .sort((a, b) => {
      const left = Number(a.players.split("/")[0]?.trim() ?? "0");
      const right = Number(b.players.split("/")[0]?.trim() ?? "0");
      return right - left;
    });

  const start = Math.max(0, page) * pageSize;
  const items = catalog.slice(start, start + pageSize);
  return {
    items,
    total: catalog.length,
    page,
    hasMore: start + pageSize < catalog.length,
  };
};
