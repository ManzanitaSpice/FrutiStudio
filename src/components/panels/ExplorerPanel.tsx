import { useEffect, useMemo, useState } from "react";

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

const explorerCategories: ExplorerCategory[] = [
  "Modpacks",
  "Mods",
  "Shaders",
  "Resource Packs",
  "Data Packs",
  "Worlds",
  "Addons",
];

const minecraftVersions = ["", "1.21.1", "1.21", "1.20.1", "1.19.2"];
const loaders = ["", "forge", "fabric", "quilt", "neoforge"];

interface ExplorerPanelProps {
  externalQuery?: string;
  externalQueryToken?: number;
}

export const ExplorerPanel = ({ externalQuery, externalQueryToken }: ExplorerPanelProps) => {
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
  const [installState, setInstallState] = useState<{ item: ExplorerItem; version?: ExplorerItemFileVersion } | null>(null);

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
    const bySource = {
      Modrinth: items.filter((item) => item.source === "Modrinth"),
      CurseForge: items.filter((item) => item.source === "CurseForge"),
    };
    return bySource;
  }, [items]);

  const updateFilter = <K extends keyof ExplorerFilters>(
    key: K,
    value: ExplorerFilters[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 0 }));
    setItems([]);
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
      <div className="panel-view__header">
        <div>
          <h2>Explorador unificado</h2>
          <p>
            Catálogo completo de CurseForge + Modrinth con filtros reales, paginación y
            metadata lista para instalar.
          </p>
        </div>
      </div>

      <div className="explorer-layout">
        <aside className="explorer-layout__sidebar">
          <div className="explorer-layout__filters">
            <div className="explorer-layout__filters-header">
              <h4>Filtro avanzado</h4>
              <button type="button" onClick={() => setFilters({ category: "Modpacks", sort: "popular", platform: "all", query: "", gameVersion: "", loader: "", page: 0, pageSize: 16 })}>
                Restablecer
              </button>
            </div>
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
          <h3>Categorías</h3>
          <div className="explorer-layout__categories">
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
        </aside>

        <div className="explorer-layout__results">
          <div className="explorer-layout__toolbar">
            <div>
              <h3>{filters.category}</h3>
              <p>{total} resultados encontrados</p>
              {loading && <small>Cargando resultados...</small>}
              {error && <small className="explorer-layout__error">{error}</small>}
            </div>
            <div className="explorer-layout__sort">
              <span>Ordenar por</span>
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
                <option value="updated">Actualizaciones recientes</option>
                <option value="relevance">Relevancia</option>
              </select>
            </div>
          </div>

          <div className="explorer-layout__list">
            {Object.entries(grouped).map(([source, sourceItems]) =>
              sourceItems.length ? (
                <div key={source} className="explorer-layout__source-block">
                  <h4>{source}</h4>
                  <div className="explorer-layout__cards">
                    {sourceItems.map((item) => (
                      <article
                        key={item.id}
                        className="explorer-item explorer-item--card"
                      >
                        {item.thumbnail ? (
                          <img
                            className="explorer-item__icon"
                            src={item.thumbnail}
                            alt={item.name}
                          />
                        ) : (
                          <div className="explorer-item__icon" />
                        )}
                        <div className="explorer-item__info">
                          <h4>{item.name}</h4>
                          <p>{item.description}</p>
                          <div className="explorer-item__meta">
                            <span>{item.type}</span>
                            <span>{item.author}</span>
                            <span>{item.downloads}</span>
                            <span className="explorer-item__source">{item.source}</span>
                          </div>
                        </div>
                        <div className="explorer-item__actions">
                          <button type="button" onClick={() => setSelectedItem(item)}>
                            Ver detalle
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
