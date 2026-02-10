const featuredItems: Array<{
  id: string;
  title: string;
  subtitle: string;
  description: string;
  cta: string;
}> = [];

const categories: string[] = [];

const latestItems: Array<{
  id: string;
  name: string;
  author: string;
  type: string;
}> = [];

const trendingItems: Array<{ id: string; title: string; type: string }> = [];

const curatedLists: Array<{ id: string; title: string; items: string[] }> = [];

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

      {featuredItems.length ? (
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
      ) : (
        <div className="panel-view__hint">
          Sin novedades aún. Cuando se conecten fuentes reales se mostrarán aquí.
        </div>
      )}

      {trendingItems.length ? (
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
      ) : null}

      {categories.length ? (
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
      ) : null}

      {latestItems.length ? (
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
      ) : null}

      {curatedLists.length ? (
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
      ) : null}
    </section>
  );
};
