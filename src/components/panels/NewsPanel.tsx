import { useEffect, useState } from "react";

import {
  type NewsOverview,
  fetchNewsOverview,
} from "../../services/newsService";

export const NewsPanel = () => {
  const [news, setNews] = useState<NewsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("Todos");

  useEffect(() => {
    let isActive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchNewsOverview();
        if (isActive) {
          setNews(data);
        }
      } catch (loadError) {
        if (isActive) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No se pudieron cargar las novedades.",
          );
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, []);

  const featuredItems = news?.featuredItems ?? [];
  const trendingItems = news?.trendingItems ?? [];
  const latestItems = news?.latestItems ?? [];
  const curatedLists = news?.curatedLists ?? [];
  const carousels = news?.carousels ?? [];
  const categories = news?.categories ?? [];
  const warnings = news?.warnings ?? [];
  const allCategories = ["Todos", ...categories];

  const normalizeCategory = (value?: string) =>
    value?.toLowerCase().replace(/\s+/g, "") ?? "";
  const matchesCategory = (value?: string) => {
    if (activeCategory === "Todos") {
      return true;
    }
    return (
      normalizeCategory(value).includes(normalizeCategory(activeCategory)) ||
      normalizeCategory(activeCategory).includes(normalizeCategory(value))
    );
  };

  const filteredFeatured = featuredItems.filter((item) =>
    matchesCategory(item.category),
  );
  const filteredTrending = trendingItems.filter((item) =>
    matchesCategory(item.category),
  );
  const filteredLatest = latestItems.filter((item) =>
    matchesCategory(item.category),
  );
  const filteredCarousels = carousels
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => matchesCategory(item.category)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <section className="panel-view panel-view--news">
      <div className="panel-view__header">
        <div>
          <h2>Novedades</h2>
          <p>
            Descubre nuevos modpacks, mods, datapacks y mapas combinando
            CurseForge, Modrinth y PlanetMinecraft.
          </p>
        </div>
      </div>

      {loading && !news ? (
        <div className="panel-view__hint">Conectando a las fuentes...</div>
      ) : null}
      {error ? <div className="panel-view__error">{error}</div> : null}
      {warnings.length ? (
        <div className="panel-view__warning">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {allCategories.length ? (
        <div className="news-category-bar">
          {allCategories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={
                activeCategory === category
                  ? "news-category-bar__button news-category-bar__button--active"
                  : "news-category-bar__button"
              }
            >
              {category}
            </button>
          ))}
        </div>
      ) : null}

      {filteredFeatured.length ? (
        <div className="news-hero news-hero--carousel">
          {filteredFeatured.map((item) => (
            <article key={item.id} className="news-hero__card">
              <div className="news-hero__media">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.title} loading="lazy" />
                ) : null}
              </div>
              <div className="news-hero__content">
                <span className="news-hero__subtitle">{item.subtitle}</span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <div className="news-hero__actions">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.cta}
                    </a>
                  ) : (
                    <button type="button">{item.cta}</button>
                  )}
                  <span className="news-hero__source">{item.source}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel-view__hint">
          No hay destacados disponibles en este momento.
        </div>
      )}

      {filteredCarousels.map((section) => (
        <div key={section.id} className="news-section">
          <div className="news-section__header">
            <h3>{section.title}</h3>
            <span className="news-section__meta">Fuentes combinadas</span>
          </div>
          <div className="news-carousel">
            <div className="news-carousel__track">
              {section.items.map((item) => (
                <article key={item.id} className="news-carousel__card">
                  <div className="news-carousel__icon">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.title} loading="lazy" />
                    ) : (
                      <span>{item.title.slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <h4>{item.title}</h4>
                    <p>
                      {item.subtitle} · {item.source}
                    </p>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        Abrir
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      ))}

      {filteredTrending.length ? (
        <div className="news-section">
          <div className="news-section__header">
            <h3>En tendencia ahora</h3>
            <span className="news-section__meta">Actualizado cada 15 min</span>
          </div>
          <div className="news-carousel">
            <div className="news-carousel__track">
              {[...filteredTrending, ...filteredTrending].map((item, index) => (
                <article
                  key={`${item.id}-${index}`}
                  className="news-carousel__card"
                >
                  <div className="news-carousel__icon">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.title} loading="lazy" />
                    ) : (
                      <span>{item.title.slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <h4>{item.title}</h4>
                    <p>
                      {item.type} · {item.source}
                    </p>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        Abrir
                      </a>
                    ) : null}
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
              <button
                key={category}
                type="button"
                className="news-category"
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {filteredLatest.length ? (
        <div className="news-section">
          <div className="news-section__header">
            <h3>Últimos lanzamientos</h3>
            <button type="button">Actualizar</button>
          </div>
          <div className="news-latest">
            {filteredLatest.map((item) => (
              <article key={item.id} className="news-latest__card">
                <div className="news-latest__icon">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} loading="lazy" />
                  ) : (
                    <span>{item.name.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div>
                  <h4>{item.name}</h4>
                  <p>
                    {item.type} · {item.author}
                  </p>
                  <span className="news-latest__source">{item.source}</span>
                </div>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    Abrir
                  </a>
                ) : (
                  <button type="button">Instalar</button>
                )}
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
                <div className="news-list-card__footer">
                  <span>{list.source}</span>
                  <button type="button">Abrir lista</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
};
