import { useEffect, useMemo, useState } from "react";

import {
  type ExplorerCategory,
  type ExplorerFilters,
  type ExplorerItem,
  type ExplorerItemDetails,
  fetchExplorerItemDetails,
  fetchUnifiedCatalog,
} from "../../services/explorerService";

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

export const ExplorerPanel = () => {
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
  const [installItem, setInstallItem] = useState<ExplorerItem | null>(null);

  useEffect(() => {
    let isActive = true;

    const loadItems = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchUnifiedCatalog(filters);
        if (isActive) {
          setItems((prev) => (filters.page === 0 ? data.items : [...prev, ...data.items]));
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

  return (
    <section className="panel-view panel-view--explorer">
      <div className="panel-view__header">
        <div>
          <h2>Explorador unificado</h2>
          <p>
            Catálogo completo de CurseForge + Modrinth con filtros reales,
            paginación y metadata lista para instalar.
          </p>
        </div>
      </div>

      <div className="explorer-layout">
        <aside className="explorer-layout__sidebar">
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
          <div className="explorer-layout__filters">
            <h4>Filtro avanzado</h4>
            <input
              type="search"
              placeholder="Buscar por nombre..."
              value={filters.query}
              onChange={(event) => updateFilter("query", event.target.value)}
            />
            <label>
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
            <label>
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
            <label>
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
                <div key={source}>
                  <h4>{source}</h4>
                  {sourceItems.map((item) => (
                    <article key={item.id} className="explorer-item">
                      {item.thumbnail ? (
                        <img className="explorer-item__icon" src={item.thumbnail} alt={item.name} />
                      ) : (
                        <div className="explorer-item__icon" />
                      )}
                      <div className="explorer-item__info">
                        <h4>{item.name}</h4>
                        <p>
                          {item.type} · {item.author}
                        </p>
                        <span>{item.downloads}</span>
                        <span className="explorer-item__source">{item.source}</span>
                      </div>
                      <div className="explorer-item__actions">
                        <button type="button" onClick={() => setSelectedItem(item)}>
                          Ver detalle
                        </button>
                        <button
                          type="button"
                          className="explorer-item__secondary"
                          onClick={() => setInstallItem(item)}
                        >
                          Instalar
                        </button>
                      </div>
                    </article>
                  ))}
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
              onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 0) + 1 }))}
            >
              Cargar más
            </button>
          ) : null}
        </div>
      </div>

      {selectedItem ? (
        <div className="instance-editor__backdrop" onClick={() => setSelectedItem(null)}>
          <article className="status-bar__news-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>{selectedItem.name}</h3>
              <button type="button" onClick={() => setSelectedItem(null)}>
                ✕
              </button>
            </header>
            {detailsLoading || !details ? (
              <p>Cargando metadata del proyecto...</p>
            ) : (
              <>
                <p>{details.description}</p>
                <p>
                  <strong>Autor:</strong> {details.author} · <strong>Plataforma:</strong>{" "}
                  {details.source}
                </p>
                <p>
                  <strong>Loaders:</strong> {details.loaders.slice(0, 6).join(", ") || "Sin datos"}
                </p>
                <p>
                  <strong>Versiones:</strong>{" "}
                  {details.gameVersions.slice(0, 8).join(", ") || "Sin datos"}
                </p>
                {details.gallery.length ? (
                  <div className="news-latest">
                    {details.gallery.slice(0, 4).map((image) => (
                      <img key={image} src={image} alt={details.title} className="news-latest__icon" />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </article>
        </div>
      ) : null}

      {installItem ? (
        <div className="instance-editor__backdrop" onClick={() => setInstallItem(null)}>
          <article className="status-bar__news-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>Instalar “{installItem.name}”</h3>
              <button type="button" onClick={() => setInstallItem(null)}>
                ✕
              </button>
            </header>
            <p>Selecciona el destino de instalación.</p>
            <div className="instance-import__actions">
              <button type="button">Crear nueva instancia</button>
              {installItem.type.toLowerCase().includes("modpack") ? null : (
                <button type="button">Instalar en instancia existente</button>
              )}
            </div>
            {installItem.type.toLowerCase().includes("modpack") ? (
              <small>Los modpacks se instalan como una instancia nueva completa.</small>
            ) : null}
          </article>
        </div>
      ) : null}
    </section>
  );
};
