import { fetchExplorerItems } from "./explorerService";
import { fetchServerListings } from "./serverService";

export interface GlobalSearchSuggestion {
  id: string;
  label: string;
  description: string;
  source: string;
  url?: string;
  imageUrl?: string;
}

const normalize = (value: string) => value.toLowerCase().trim();

export const fetchGlobalSearchSuggestions = async (
  term: string,
): Promise<GlobalSearchSuggestion[]> => {
  const query = normalize(term);
  if (query.length < 2) {
    return [];
  }
  const searchTerm = term.trim();

  const tasks = await Promise.allSettled([
    fetchExplorerItems("Mods", { query: searchTerm, limit: 10, sort: "downloads" }),
    fetchExplorerItems("Modpacks", {
      query: searchTerm,
      limit: 10,
      sort: "downloads",
    }),
    fetchExplorerItems("Worlds", { query: searchTerm, limit: 8, sort: "recent" }),
    fetchExplorerItems("Resource Packs", {
      query: searchTerm,
      limit: 6,
      sort: "recent",
    }),
    fetchServerListings(),
  ]);

  const [mods, modpacks, worlds, resources, servers] = tasks.map((task) =>
    task.status === "fulfilled" ? task.value : [],
  );

  const explorerSuggestions = [...mods, ...modpacks, ...worlds, ...resources]
    .filter((item) => normalize(item.name).includes(query))
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      label: item.name,
      description: `${item.type} · ${item.source}`,
      source: item.source,
      url: item.url,
      imageUrl: item.imageUrl,
    }));

  const serverSuggestions = servers
    .filter(
      (server) =>
        normalize(server.name).includes(query) ||
        normalize(server.ip).includes(query),
    )
    .slice(0, 4)
    .map((server) => ({
      id: server.id,
      label: server.name,
      description: `Server · ${server.ip}`,
      source: server.official ? "Oficial" : "Comunidad",
      url: server.website,
    }));

  return [...explorerSuggestions, ...serverSuggestions];
};
