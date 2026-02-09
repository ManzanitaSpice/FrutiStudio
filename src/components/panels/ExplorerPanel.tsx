import { useState } from "react";

const explorerCategories = [
  "Modpacks",
  "Mods",
  "Data Packs",
  "Resource Packs",
  "Shaders",
  "Worlds",
  "Addons",
];

const explorerItems = [
  {
    id: "all-the-mons",
    name: "All the Mons - Simple",
    author: "ATM Team",
    downloads: "5.10M",
    type: "Modpack",
  },
  {
    id: "pam-harvest",
    name: "Pam's HarvestCraft 2",
    author: "pamharvestcraft",
    downloads: "1.5M",
    type: "Mod",
  },
  {
    id: "bakery",
    name: "Bakeries",
    author: "Renvigesa",
    downloads: "980K",
    type: "Mod",
  },
  {
    id: "fruitful",
    name: "Fruitful Fun",
    author: "Snownee",
    downloads: "2.2M",
    type: "Mod",
  },
];

export const ExplorerPanel = () => {
  const [selectedCategory, setSelectedCategory] = useState(explorerCategories[0]);

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
            {explorerItems.map((item) => (
              <article key={item.id} className="explorer-item">
                <div className="explorer-item__icon" />
                <div className="explorer-item__info">
                  <h4>{item.name}</h4>
                  <p>
                    {item.type} · {item.author}
                  </p>
                  <span>{item.downloads} descargas</span>
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
