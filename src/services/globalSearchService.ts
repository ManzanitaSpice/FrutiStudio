import { fetchExplorerItems } from "./explorerService";
import { fetchServerListings } from "./serverService";

export interface GlobalSearchSuggestion {
  id: string;
  label: string;
  description: string;
  source: string;
  url?: string;
}

const normalize = (value: string) => value.toLowerCase().trim();

export const fetchGlobalSearchSuggestions = async (
  term: string,
): Promise<GlobalSearchSuggestion[]> => {
  const query = normalize(term);
  if (query.length < 2) {
    return [];
  }

  const tasks = await Promise.allSettled([
    fetchExplorerItems("Mods"),
    fetchExplorerItems("Modpacks"),
    fetchExplorerItems("Worlds"),
    fetchServerListings(),
  ]);

  const [mods, modpacks, worlds, servers] = tasks.map((task) =>
    task.status === "fulfilled" ? task.value : [],
  );

  const explorerSuggestions = [...mods, ...modpacks, ...worlds]
    .filter((item) => normalize(item.name).includes(query))
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      label: item.name,
      description: `${item.type} · ${item.source}`,
      source: item.source,
      url: item.url,
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
