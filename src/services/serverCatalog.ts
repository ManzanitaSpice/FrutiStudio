export interface SponsoredServerDefinition {
  id: string;
  name: string;
  ip: string;
  tags: string[];
  website: string;
  description: string;
  serverType: string;
  banner: string;
}

export const sponsoredServers: SponsoredServerDefinition[] = [
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
];
