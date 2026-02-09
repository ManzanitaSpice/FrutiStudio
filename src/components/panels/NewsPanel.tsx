const featuredItems = [
  {
    id: "mod-awards",
    title: "From Imagination to Gameplay",
    subtitle: "Modpacks destacados por la comunidad",
    description:
      "Nuevos packs premiados, texturas recomendadas y shaders con mejor rendimiento.",
  },
  {
    id: "seasonal",
    title: "Temporada Creativa",
    subtitle: "Especiales del mes",
    description: "Nuevas aventuras, mundos y datapacks para explorar.",
  },
];

const categories = [
  "Modpacks",
  "Mods",
  "Data Packs",
  "Resource Packs",
  "Shaders",
  "Worlds",
  "Addons",
  "Customization",
];

const latestItems = [
  {
    id: "terra",
    name: "TerraFirmaGreg - Core",
    author: "Exception",
    type: "Mod",
  },
  {
    id: "storage",
    name: "Storage Drawers Unofficial",
    author: "Clepto",
    type: "Mod",
  },
  {
    id: "pipe",
    name: "Pipe Connector",
    author: "Heaser",
    type: "Mod",
  },
  {
    id: "xaero",
    name: "XaeroPlus",
    author: "CoinRS",
    type: "Mod",
  },
];

export const NewsPanel = () => {
  return (
    <section className="panel-view panel-view--news">
      <div className="panel-view__header">
        <div>
          <h2>Novedades</h2>
          <p>
            Descubre nuevos modpacks, mods, texturas, shaders y servidores con
            tendencia.
          </p>
        </div>
        <div className="panel-view__actions">
          <input type="search" placeholder="Buscar novedades..." />
          <button type="button">Explorar todo</button>
        </div>
      </div>

      <div className="news-hero">
        {featuredItems.map((item) => (
          <article key={item.id} className="news-hero__card">
            <div className="news-hero__media" />
            <div className="news-hero__content">
              <span className="news-hero__subtitle">{item.subtitle}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <button type="button">Ver detalles</button>
            </div>
          </article>
        ))}
      </div>

      <div className="news-section">
        <div className="news-section__header">
          <h3>Categorías populares</h3>
          <button type="button">Ver todas</button>
        </div>
        <div className="news-section__grid">
          {categories.map((category) => (
            <button key={category} type="button" className="news-category">
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="news-section">
        <div className="news-section__header">
          <h3>Últimos lanzamientos</h3>
          <button type="button">Actualizar</button>
        </div>
        <div className="news-latest">
          {latestItems.map((item) => (
            <article key={item.id} className="news-latest__card">
              <div className="news-latest__icon" />
              <div>
                <h4>{item.name}</h4>
                <p>
                  {item.type} · {item.author}
                </p>
              </div>
              <button type="button">Instalar</button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};
