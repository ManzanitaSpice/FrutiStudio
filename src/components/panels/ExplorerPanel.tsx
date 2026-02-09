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

const fallbackItems: ExplorerItem[] = [
  {
    id: "all-the-mons",
    name: "All the Mons - Simple",
    author: "ATM Team",
    downloads: "5.10M descargas",
    type: "Modpack",
  },
  {
    id: "pam-harvest",
    name: "Pam's HarvestCraft 2",
    author: "pamharvestcraft",
    downloads: "1.5M descargas",
    type: "Mod",
  },
  {
    id: "bakery",
    name: "Bakeries",
    author: "Renvigesa",
    downloads: "980K descargas",
    type: "Mod",
  },
  {
    id: "fruitful",
    name: "Fruitful Fun",
    author: "Snownee",
    downloads: "2.2M descargas",
    type: "Mod",
  },
];

export const ExplorerPanel = () => {
  const [selectedCategory, setSelectedCategory] = useState(explorerCategories[0]);
  const [items, setItems] = useState<ExplorerItem[]>(fallbackItems);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const loadItems = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchExplorerItems(selectedCategory);
        if (isActive) {
          setItems(data.length ? data : fallbackItems);
        }
      } catch (fetchError) {
        if (isActive) {
          setItems(fallbackItems);
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
            <h4>Filtros rápidos</h4>
            <label>
              <input type="checkbox" defaultChecked /> Solo populares
            </label>
            <label>
              <input type="checkbox" /> Compatible con 1.21
            </label>
            <label>
              <input type="checkbox" /> Actualizados recientemente
            </label>
          </div>
        </aside>

        <div className="explorer-layout__results">
          <div className="explorer-layout__toolbar">
            <div>
              <h3>{selectedCategory}</h3>
              <p>Selecciona un elemento para instalar o crear instancia.</p>
              {loading && <small>Cargando resultados...</small>}
              {error && <small className="explorer-layout__error">{error}</small>}
            </div>
            <div className="explorer-layout__sort">
              <span>Ordenar por</span>
              <select defaultValue="popular">
                <option value="popular">Popularidad</option>
                <option value="recent">Reciente</option>
                <option value="downloads">Descargas</option>
              </select>
            </div>
          </div>

          <div className="explorer-layout__list">
            {items.map((item) => (
              <article key={item.id} className="explorer-item">
                <div className="explorer-item__icon" />
                <div className="explorer-item__info">
                  <h4>{item.name}</h4>
                  <p>
                    {item.type} · {item.author}
                  </p>
                  <span>{item.downloads}</span>
                </div>
                <div className="explorer-item__actions">
                  <button type="button">Instalar</button>
                  <button type="button" className="explorer-item__secondary">
                    Crear instancia
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
