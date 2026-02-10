export interface PlanetMinecraftItem {
  id: string;
  title: string;
  link: string;
  author: string;
  category: string;
}

const FEED_BASE = "https://www.planetminecraft.com/rss";
const PROXY_BASE = "https://api.allorigins.win/raw?url=";

const fetchFeed = async (path: string) => {
  const url = `${PROXY_BASE}${encodeURIComponent(`${FEED_BASE}/${path}`)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`PlanetMinecraft ${response.status}`);
  }
  return response.text();
};

const readText = (element: Element | null) => element?.textContent?.trim() ?? "";

const parseFeed = (xmlText: string): PlanetMinecraftItem[] => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "text/xml");
  const items = Array.from(xml.querySelectorAll("item"));
  return items.slice(0, 8).map((item, index) => {
    const title = readText(item.querySelector("title"));
    const link = readText(item.querySelector("link"));
    const author =
      readText(item.querySelector("dc\\:creator")) ||
      readText(item.querySelector("author")) ||
      "PlanetMinecraft";
    const category = readText(item.querySelector("category")) || "Modpack";
    return {
      id: link || `${title}-${index}`,
      title,
      link,
      author,
      category,
    };
  });
};

export const fetchPlanetMinecraftModpacks = async () => {
  const xmlText = await fetchFeed("modpacks/");
  return parseFeed(xmlText);
};

export const fetchPlanetMinecraftResources = async () => {
  const xmlText = await fetchFeed("texture-packs/");
  return parseFeed(xmlText);
};

export const fetchPlanetMinecraftWorlds = async () => {
  const xmlText = await fetchFeed("projects/?project_type=world");
  return parseFeed(xmlText);
};

export const fetchPlanetMinecraftDataPacks = async () => {
  const xmlText = await fetchFeed("data-packs/");
  return parseFeed(xmlText);
};
