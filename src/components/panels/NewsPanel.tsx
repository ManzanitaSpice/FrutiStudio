const featuredItems = [
  {
    id: "mod-awards",
    title: "Del laboratorio al mundo",
    subtitle: "Modpacks destacados por la comunidad",
    description:
      "Packs premiados, texturas recomendadas y shaders con mejor rendimiento para tu instancia.",
    cta: "Ver colección",
  },
  {
    id: "seasonal",
    title: "Temporada Creativa",
    subtitle: "Especiales del mes",
    description:
      "Aventuras narrativas, mundos cooperativos y datapacks para jugar en grupo.",
    cta: "Explorar eventos",
  },
  {
    id: "builders",
    title: "Ruta de constructores",
    subtitle: "Escenarios cinematográficos",
    description: "Shaders suaves, resource packs HD y mapas para exhibición.",
    cta: "Abrir galería",
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

const trendingItems = [
  { id: "skyfarer", title: "Skyfarer Origins", type: "Modpack" },
  { id: "aurora", title: "Aurora Shader", type: "Shader" },
  { id: "biome", title: "Biome Beats", type: "Data Pack" },
  { id: "moonfall", title: "Moonfall City", type: "World" },
  { id: "farm", title: "Farm Suite", type: "Mod" },
  { id: "atlas", title: "Atlas Journey", type: "Modpack" },
];

const curatedLists = [
  {
    id: "popular",
    title: "Populares de la semana",
    items: ["Create Expanded", "Better Villages", "Chisel Pro", "Lightmaps+ 2.0"],
  },
  {
    id: "coop",
    title: "Para jugar en cooperativo",
    items: ["Cottage Life", "Farm Together+", "Questing Worlds", "Team Logistics"],
  },
  {
    id: "performance",
    title: "Optimización & FPS",
    items: ["Smooth Lights", "Sodium+", "Instant Loading", "Memory Saver"],
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
      </div>

      <div className="news-hero news-hero--carousel">
        {featuredItems.map((item) => (
          <article key={item.id} className="news-hero__card">
            <div className="news-hero__media" />
            <div className="news-hero__content">
              <span className="news-hero__subtitle">{item.subtitle}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <button type="button">{item.cta}</button>
            </div>
          </article>
        ))}
      </div>

      <div className="news-section">
        <div className="news-section__header">
          <h3>En tendencia ahora</h3>
          <span className="news-section__meta">Actualizado cada 15 min</span>
        </div>
        <div className="news-carousel">
          <div className="news-carousel__track">
            {[...trendingItems, ...trendingItems].map((item, index) => (
              <article
                key={`${item.id}-${index}`}
                className="news-carousel__card"
              >
                <div className="news-carousel__icon" />
                <div>
                  <h4>{item.title}</h4>
                  <p>{item.type}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
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

      <div className="news-section">
        <div className="news-section__header">
          <h3>Listas curadas</h3>
          <button type="button">Ver más</button>
        </div>
        <div className="news-lists">
          {curatedLists.map((list) => (
            <article key={list.id} className="news-list-card">
              <h4>{list.title}</h4>
              <ul>
                {list.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <button type="button">Abrir lista</button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};
