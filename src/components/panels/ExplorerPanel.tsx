import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";

import { ProductDetailsDialog, ProductInstallDialog } from "../ProductDialogs";

import {
  type ExplorerCategory,
  type ExplorerFilters,
  type ExplorerItem,
  type ExplorerItemDetails,
  type ExplorerItemFileVersion,
  fetchExplorerItemDetails,
  fetchUnifiedCatalog,
} from "../../services/explorerService";
import { loadConfig, saveConfig } from "../../services/configService";
import { fetchMinecraftVersions } from "../../services/minecraftVersionService";

const explorerCategories: ExplorerCategory[] = [
  "Modpacks",
  "Mods",
  "Shaders",
  "Resource Packs",
  "Data Packs",
  "Worlds",
  "Addons",
];

const loaders = ["", "forge", "fabric", "quilt", "neoforge"];

type ExplorerViewMode = "cards" | "list" | "table";
type SortDirection = "desc" | "asc";

interface ExplorerPanelProps {
  externalQuery?: string;
  externalQueryToken?: number;
}

const formatFileSize = (bytes?: number) => {
  if (!bytes || bytes <= 0) {
    return "N/D";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
};

const oneLine = (text: string) => {
  const sanitized = text.replace(/\s+/g, " ").trim();
  if (sanitized.length <= 110) {
    return sanitized;
  }
  return `${sanitized.slice(0, 107)}...`;
};

export const ExplorerPanel = ({
  externalQuery,
  externalQueryToken,
}: ExplorerPanelProps) => {
  const [filters, setFilters] = useState<ExplorerFilters>({
    category: "Modpacks",
    sort: "popular",
    platform: "all",
    query: "",
    gameVersion: "",
    loader: "",
    page: 0,
    pageSize: 16,
  });
  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedItem, setSelectedItem] = useState<ExplorerItem | null>(null);
  const [details, setDetails] = useState<ExplorerItemDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [installState, setInstallState] = useState<{
    item: ExplorerItem;
    version?: ExplorerItemFileVersion;
  } | null>(null);
  const [minecraftVersions, setMinecraftVersions] = useState<string[]>([""]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: ExplorerItem;
  } | null>(null);
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [viewMode, setViewMode] = useState<ExplorerViewMode>("cards");

  useEffect(() => {
    let isActive = true;
    const loadMinecraftVersions = async () => {
      try {
        const versions = await fetchMinecraftVersions();
        if (!isActive) {
          return;
        }
        const realReleaseVersions = versions
          .filter((version) => version.type === "release")
          .map((version) => version.id);
        setMinecraftVersions(["", ...Array.from(new Set(realReleaseVersions))]);
      } catch {
        if (isActive) {
          setMinecraftVersions(["", "1.21.4", "1.21.1", "1.20.6", "1.20.1", "1.19.4"]);
        }
      }
    };
    void loadMinecraftVersions();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    const hydrate = async () => {
      const config = await loadConfig();
      if (!config.explorerFilters) {
        return;
      }
      setFilters((prev) => ({
        ...prev,
        ...config.explorerFilters,
        page: 0,
      }));
      setItems([]);
    };
    void hydrate();
  }, []);

  useEffect(() => {
    if (!externalQueryToken || !externalQuery?.trim()) {
      return;
    }
    setFilters((prev) => ({ ...prev, query: externalQuery.trim(), page: 0 }));
    setItems([]);
  }, [externalQuery, externalQueryToken]);

  useEffect(() => {
    let isActive = true;

    const loadItems = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchUnifiedCatalog(filters);
        if (isActive) {
          setItems((prev) =>
            filters.page === 0 ? data.items : [...prev, ...data.items],
          );
          setHasMore(data.hasMore);
          setTotal(data.total);
        }
      } catch (fetchError) {
        if (isActive) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "No se pudo cargar desde la API.",
          );
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void loadItems();
    return () => {
      isActive = false;
    };
  }, [filters]);

  useEffect(() => {
    if (!selectedItem) {
      setDetails(null);
      return;
    }
    let isActive = true;

    const loadDetails = async () => {
      setDetailsLoading(true);
      try {
        const data = await fetchExplorerItemDetails(selectedItem);
        if (isActive) {
          setDetails(data);
        }
      } finally {
        if (isActive) {
          setDetailsLoading(false);
        }
      }
    };

    void loadDetails();

    return () => {
      isActive = false;
    };
  }, [selectedItem]);

  const grouped = useMemo(() => {
    const sortedItems = [...items].sort((a, b) => {
      if (filters.sort === "updated") {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return sortDirection === "asc" ? aTime - bTime : bTime - aTime;
      }
      if (filters.sort === "relevance") {
        return sortDirection === "asc"
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
      return sortDirection === "asc"
        ? a.rawDownloads - b.rawDownloads
        : b.rawDownloads - a.rawDownloads;
    });

    return {
      Modrinth: sortedItems.filter((item) => item.source === "Modrinth"),
      CurseForge: sortedItems.filter((item) => item.source === "CurseForge"),
      Otros: sortedItems.filter(
        (item) => item.source !== "Modrinth" && item.source !== "CurseForge",
      ),
    };
  }, [filters.sort, items, sortDirection]);

  const updateFilter = <K extends keyof ExplorerFilters>(
    key: K,
    value: ExplorerFilters[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 0 }));
    setItems([]);
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (contextMenu) {
        setContextMenu(null);
        return;
      }
      if (installState) {
        setInstallState(null);
        return;
      }
      if (selectedItem) {
        setSelectedItem(null);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [contextMenu, installState, selectedItem]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  const handleItemContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    item: ExplorerItem,
  ) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, item });
  };

  useEffect(() => {
    const persist = async () => {
      const config = await loadConfig();
      await saveConfig({
        ...config,
        explorerFilters: {
          category: filters.category,
          query: filters.query,
          gameVersion: filters.gameVersion,
          loader: filters.loader,
          platform: filters.platform,
          sort: filters.sort,
        },
      });
    };
    void persist();
  }, [
    filters.category,
    filters.gameVersion,
    filters.loader,
    filters.platform,
    filters.query,
    filters.sort,
  ]);

  return (
    <section className="panel-view panel-view--explorer">
      <div className="explorer-layout explorer-layout--upgraded">
        <div className="explorer-layout__results">
          <div className="explorer-layout__toolbar explorer-layout__toolbar--top">
            <div>
              <h3>{filters.category}</h3>
              <p>{total} resultados encontrados</p>
              {loading && <small>Cargando resultados...</small>}
              {error && <small className="explorer-layout__error">{error}</small>}
            </div>
            <div className="explorer-layout__actions">
              <button type="button" onClick={() => setShowAdvancedFilter((prev) => !prev)}>
                Filtro avanzado ▾
              </button>
              <label className="explorer-layout__sort">
                Ordenar
                <select
                  value={filters.sort}
                  onChange={(event) =>
                    updateFilter(
                      "sort",
                      event.target.value as "popular" | "updated" | "relevance",
                    )
                  }
                >
                  <option value="popular">Popularidad</option>
                  <option value="updated">Actualización</option>
                  <option value="relevance">Relevancia</option>
                </select>
              </label>
              <button type="button" onClick={() => setSortDirection("asc")}>
                Ascendente
              </button>
              <button type="button" onClick={() => setSortDirection("desc")}>
                Descendente
              </button>
              <label className="explorer-layout__sort">
                Vista
                <select
                  value={viewMode}
                  onChange={(event) =>
                    setViewMode(event.target.value as "cards" | "list" | "table")
                  }
                >
                  <option value="cards">Tarjetas</option>
                  <option value="list">Lista</option>
                  <option value="table">Tabla</option>
                </select>
              </label>
            </div>
          </div>

          {showAdvancedFilter ? (
            <div className="explorer-layout__advanced-panel">
              <div className="explorer-layout__filters-header">
                <h4>Filtro avanzado</h4>
                <button
                  type="button"
                  onClick={() =>
                    setFilters({
                      category: "Modpacks",
                      sort: "popular",
                      platform: "all",
                      query: "",
                      gameVersion: "",
                      loader: "",
                      page: 0,
                      pageSize: 16,
                    })
                  }
                >
                  Restablecer
                </button>
              </div>

              <div className="explorer-layout__filters-grid">
                <input
                  type="search"
                  placeholder="Buscar por nombre..."
                  value={filters.query}
                  onChange={(event) => updateFilter("query", event.target.value)}
                />
                <label className="explorer-layout__field">
                  Minecraft
                  <select
                    value={filters.gameVersion}
                    onChange={(event) => updateFilter("gameVersion", event.target.value)}
                  >
                    {minecraftVersions.map((version) => (
                      <option key={version || "all"} value={version}>
                        {version || "Todas"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="explorer-layout__field">
                  Loader
                  <select
                    value={filters.loader}
                    onChange={(event) => updateFilter("loader", event.target.value)}
                  >
                    {loaders.map((loader) => (
                      <option key={loader || "all"} value={loader}>
                        {loader || "Todos"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="explorer-layout__field">
                  Plataforma
                  <select
                    value={filters.platform}
                    onChange={(event) =>
                      updateFilter(
                        "platform",
                        event.target.value as "all" | "modrinth" | "curseforge",
                      )
                    }
                  >
                    <option value="all">Todas</option>
                    <option value="modrinth">Modrinth</option>
                    <option value="curseforge">CurseForge</option>
                  </select>
                </label>
              </div>

              <div className="explorer-layout__categories-inline">
                {explorerCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => updateFilter("category", category)}
                    className={
                      filters.category === category
                        ? "explorer-layout__category explorer-layout__category--active"
                        : "explorer-layout__category"
                    }
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div
            className={`explorer-layout__list explorer-layout__list--${viewMode}`}
          >
            {Object.entries(grouped).map(([source, sourceItems]) =>
              sourceItems.length ? (
                <div key={source} className="explorer-layout__source-block">
                  <h4>{source}</h4>
                  <div className="explorer-layout__cards">
                    {sourceItems.map((item) => (
                      <article
                        key={item.id}
                        className="explorer-item explorer-item--card"
                        onContextMenu={(event) => handleItemContextMenu(event, item)}
                      >
                        {item.thumbnail ? (
                          <img
                            className="explorer-item__icon"
                            src={item.thumbnail}
                            alt={item.name}
                          />
                        ) : (
                          <img
                            className="explorer-item__icon explorer-item__icon--fallback"
                            src="/tauri.svg"
                            alt="Logo Interface"
                          />
                        )}
                        <div className="explorer-item__info">
                          <h4>{item.name}</h4>
                          <p>{oneLine(item.description)}</p>
                          <div className="explorer-item__meta explorer-item__meta--rich">
                            <span>Autor: {item.author}</span>
                            <span>Targets: {item.type}</span>
                            <span>Descargas: {item.downloads}</span>
                            <span>Última actualización: {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : "N/D"}</span>
                            <span>Peso: {formatFileSize(item.fileSizeBytes)}</span>
                            <span>Loader: {item.loaders[0] ?? "N/D"}</span>
                            <span>Minecraft: {item.versions[0] ?? "N/D"}</span>
                            <span className="explorer-item__source">{item.source}</span>
                          </div>
                        </div>
                        <div className="explorer-item__actions">
                          <button type="button" onClick={() => setSelectedItem(item)}>
                            Ver más
                          </button>
                          <button
                            type="button"
                            className="explorer-item__secondary"
                            onClick={() => setInstallState({ item })}
                          >
                            Instalar
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null,
            )}
            {!items.length && !loading ? (
              <div className="explorer-layout__empty">
                <p>No se encontraron resultados para esos filtros.</p>
              </div>
            ) : null}
          </div>

          {hasMore ? (
            <button
              type="button"
              className="explorer-item__secondary"
              disabled={loading}
              onClick={() =>
                setFilters((prev) => ({ ...prev, page: (prev.page ?? 0) + 1 }))
              }
            >
              Cargar más
            </button>
          ) : null}
        </div>
      </div>

      {contextMenu ? (
        <div
          className="section-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <span className="section-context-menu__title">{contextMenu.item.name}</span>
          <button type="button" onClick={() => setSelectedItem(contextMenu.item)}>
            Ver más
          </button>
          <button
            type="button"
            onClick={() => setInstallState({ item: contextMenu.item })}
          >
            Instalar
          </button>
          <button
            type="button"
            onClick={() =>
              navigator.clipboard.writeText(contextMenu.item.url ?? contextMenu.item.name)
            }
          >
            Copiar enlace/nombre
          </button>
        </div>
      ) : null}

      {selectedItem ? (
        <ProductDetailsDialog
          item={selectedItem}
          details={details}
          loading={detailsLoading}
          onClose={() => setSelectedItem(null)}
          onInstall={(item, version) => setInstallState({ item, version })}
        />
      ) : null}

      {installState ? (
        <ProductInstallDialog
          item={installState.item}
          version={installState.version}
          onClose={() => setInstallState(null)}
        />
      ) : null}
    </section>
  );
};
