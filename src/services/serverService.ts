import { loadLocalServers } from "./localServerService";
import { fetchRemoteServerListings } from "./remoteServerService";

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
  source: "local" | "remote";
}

export interface ServerListingResult {
  items: ServerListing[];
  total: number;
  page: number;
  hasMore: boolean;
}

const mapLocalServers = (): ServerListing[] =>
  loadLocalServers().map((server) => ({
    id: server.id,
    name: server.name,
    ip: `${server.host}${server.port ? `:${server.port}` : ""}`,
    status: "Guardado",
    players: "N/D",
    tags: ["Local"],
    website: "",
    description: "Servidor guardado localmente por el usuario.",
    version: "N/D",
    serverType: "Local",
    banner: server.icon ?? "",
    source: "local",
  }));

export const fetchServerListings = async (
  page = 0,
  pageSize = 8,
): Promise<ServerListingResult> => {
  const [local, remote] = await Promise.all([
    Promise.resolve(mapLocalServers()),
    fetchRemoteServerListings(),
  ]);

  const catalog: ServerListing[] = [
    ...local,
    ...remote.map((item) => ({ ...item, source: "remote" as const })),
  ];

  const start = Math.max(0, page) * pageSize;
  const items = catalog.slice(start, start + pageSize);
  return {
    items,
    total: catalog.length,
    page,
    hasMore: start + pageSize < catalog.length,
  };
};
