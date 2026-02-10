import { useEffect, useState } from "react";

import {
  type ExplorerCategory,
  type ExplorerItem,
  fetchExplorerItems,
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

export const ExplorerPanel = () => {
  const [selectedCategory, setSelectedCategory] = useState(explorerCategories[0]);
  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [sourceFilter, setSourceFilter] = useState("Todas");
  const [sortFilter, setSortFilter] = useState("popular");
  const [versionFilter, setVersionFilter] = useState("Todas");
  const [loaderFilter, setLoaderFilter] = useState("Todos");
  const [forkFilter, setForkFilter] = useState("Todos");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem("fruti.explorer-filters");
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as {
        sourceFilter?: string;
        sortFilter?: string;
        versionFilter?: string;
        loaderFilter?: string;
        forkFilter?: string;
      };
      setSourceFilter(parsed.sourceFilter ?? "Todas");
      setSortFilter(parsed.sortFilter ?? "popular");
      setVersionFilter(parsed.versionFilter ?? "Todas");
      setLoaderFilter(parsed.loaderFilter ?? "Todos");
      setForkFilter(parsed.forkFilter ?? "Todos");
    } catch (loadError) {
      console.warn("No se pudieron restaurar los filtros del explorador.", loadError);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "fruti.explorer-filters",
      JSON.stringify({
        sourceFilter,
        sortFilter,
        versionFilter,
        loaderFilter,
        forkFilter,
      }),
    );
  }, [forkFilter, loaderFilter, sortFilter, sourceFilter, versionFilter]);

  useEffect(() => {
    let isActive = true;
    const loadItems = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchExplorerItems(selectedCategory);
        if (isActive) {
          setItems(data);
        }
      } catch (fetchError) {
        if (isActive) {
          setItems([]);
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
  }, [selectedCategory]);

  const parseDownloads = (value: string) => {
    const match = value.replace(",", ".").match(/([\d.]+)\s*([kKmM])?/);
    if (!match) {
      return 0;
    }
    const amount = Number.parseFloat(match[1]);
    if (Number.isNaN(amount)) {
      return 0;
    }
    const suffix = match[2]?.toLowerCase();
    if (suffix === "m") {
      return amount * 1_000_000;
    }
    if (suffix === "k") {
      return amount * 1_000;
    }
    return amount;
  };

  const filteredItems = items
    .filter((item) => (sourceFilter === "Todas" ? true : item.source === sourceFilter))
    .slice()
    .sort((left, right) => {
      if (sortFilter === "downloads") {
        return parseDownloads(right.downloads) - parseDownloads(left.downloads);
      }
      if (sortFilter === "alphabetical") {
        return left.name.localeCompare(right.name, "es", { sensitivity: "base" });
      }
      return 0;
    });

  return (
    <section className="panel-view panel-view--explorer">
      <div className="panel-view__header">
        <div>
          <h2>Explorador</h2>
          <p>
            Descarga mods, modpacks, datapacks y texturas directo a tu instancia
            o crea una nueva automáticamente.
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
                onClick={() => setSelectedCategory(category)}
                className={
                  selectedCategory === category
                    ? "explorer-layout__category explorer-layout__category--active"
                    : "explorer-layout__category"
                }
              >
                {category}
              </button>
            ))}
          </div>
          <div className="explorer-layout__filters">
            <div className="explorer-layout__filters-header">
              <h4>Filtros rápidos</h4>
              <button
                type="button"
                onClick={() => setShowAdvancedFilters((prev) => !prev)}
              >
                {showAdvancedFilters ? "Ocultar" : "Filtro avanzado"}
              </button>
            </div>
            <div className="explorer-layout__quick-filters">
              <button
                type="button"
                className={sortFilter === "popular" ? "is-active" : ""}
                onClick={() => setSortFilter("popular")}
              >
                Populares
              </button>
              <button
                type="button"
                className={sortFilter === "downloads" ? "is-active" : ""}
                onClick={() => setSortFilter("downloads")}
              >
                Más descargas
              </button>
              <button
                type="button"
                className={sortFilter === "recent" ? "is-active" : ""}
                onClick={() => setSortFilter("recent")}
              >
                Recientes
              </button>
            </div>
            {showAdvancedFilters ? (
              <div className="explorer-layout__advanced">
                <label>
                  Fuente
                  <select
                    value={sourceFilter}
                    onChange={(event) => setSourceFilter(event.target.value)}
                  >
                    <option value="Todas">Todas</option>
                    <option value="Modrinth">Modrinth</option>
                    <option value="CurseForge">CurseForge</option>
                    <option value="PlanetMinecraft">PlanetMinecraft</option>
                  </select>
                </label>
                <label>
                  Versión
                  <select
                    value={versionFilter}
                    onChange={(event) => setVersionFilter(event.target.value)}
                  >
                    <option value="Todas">Todas</option>
                    <option value="1.21">1.21+</option>
                    <option value="1.20">1.20.x</option>
                    <option value="1.19">1.19.x</option>
                  </select>
                </label>
                <label>
                  Loader/Fork
                  <select
                    value={loaderFilter}
                    onChange={(event) => setLoaderFilter(event.target.value)}
                  >
                    <option value="Todos">Todos</option>
                    <option value="Forge">Forge</option>
                    <option value="NeoForge">NeoForge</option>
                    <option value="Fabric">Fabric</option>
                    <option value="Quilt">Quilt</option>
                  </select>
                </label>
                <label>
                  Fork de origen
                  <select
                    value={forkFilter}
                    onChange={(event) => setForkFilter(event.target.value)}
                  >
                    <option value="Todos">Todos</option>
                    <option value="Vanilla">Vanilla</option>
                    <option value="Forge">Forge</option>
                    <option value="Fabric">Fabric</option>
                    <option value="Quilt">Quilt</option>
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="explorer-layout__results">
          <div className="explorer-layout__toolbar">
            <div>
              <h3>{selectedCategory}</h3>
              <p>Selecciona un elemento para instalar o crear instancia.</p>
              <div className="explorer-layout__active-filters">
                {sourceFilter !== "Todas" ? (
                  <span>Fuente: {sourceFilter}</span>
                ) : null}
                {versionFilter !== "Todas" ? (
                  <span>Versión: {versionFilter}</span>
                ) : null}
                {loaderFilter !== "Todos" ? (
                  <span>Loader: {loaderFilter}</span>
                ) : null}
                {forkFilter !== "Todos" ? <span>Fork: {forkFilter}</span> : null}
              </div>
              {loading && <small>Cargando resultados...</small>}
              {error && <small className="explorer-layout__error">{error}</small>}
            </div>
            <div className="explorer-layout__sort">
              <span>Ordenar por</span>
              <select
                value={sortFilter}
                onChange={(event) => setSortFilter(event.target.value)}
              >
                <option value="popular">Popularidad</option>
                <option value="recent">Reciente</option>
                <option value="downloads">Descargas</option>
                <option value="alphabetical">A-Z</option>
              </select>
            </div>
          </div>

          <div className="explorer-layout__list">
            {filteredItems.length ? (
              filteredItems.map((item) => (
                <article key={item.id} className="explorer-item">
                  <div className="explorer-item__icon" />
                  <div className="explorer-item__info">
                    <h4>{item.name}</h4>
                    <p>
                      {item.type} · {item.author}
                    </p>
                    <span>{item.downloads}</span>
                    <span className="explorer-item__source">{item.source}</span>
                  </div>
                  <div className="explorer-item__actions">
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        Ver
                      </a>
                    ) : (
                      <button type="button">Instalar</button>
                    )}
                    <button type="button" className="explorer-item__secondary">
                      Crear instancia
                    </button>
                  </div>
                </article>
              ))
            ) : loading ? (
              <div className="explorer-layout__empty">
                <p>Cargando resultados reales...</p>
              </div>
            ) : (
              <div className="explorer-layout__empty">
                <p>No se encontraron resultados en las fuentes conectadas.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
