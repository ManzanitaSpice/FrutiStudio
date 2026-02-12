import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";

import { ProductDetailsDialog, ProductInstallDialog } from "../ProductDialogs";
import { type NewsOverview, fetchNewsOverview } from "../../services/newsService";
import {
  type ExplorerItem,
  fetchExplorerItemDetails,
  type ExplorerItemDetails,
} from "../../services/explorerService";

export const NewsPanel = () => {
  const [news, setNews] = useState<NewsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ExplorerItem | null>(null);
  const [details, setDetails] = useState<ExplorerItemDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [installItem, setInstallItem] = useState<ExplorerItem | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: ExplorerItem;
  } | null>(null);

  const nextCarousel = () => {
    if (!popularModpacks.length) return;
    setCarouselIndex((prev) => (prev + 1) % popularModpacks.length);
  };

  const previousCarousel = () => {
    if (!popularModpacks.length) return;
    setCarouselIndex(
      (prev) => (prev - 1 + popularModpacks.length) % popularModpacks.length,
    );
  };

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

  const warnings = news?.warnings ?? [];
  const catalog = news?.catalogItems ?? [];
  const categories = news?.categories ?? [];

  const popularModpacks = useMemo(
    () =>
      [...catalog]
        .filter((item) => item.type.toLowerCase().includes("modpack"))
        .sort((a, b) => b.rawDownloads - a.rawDownloads)
        .slice(0, 10),
    [catalog],
  );

  const byCategory = useMemo(
    () =>
      categories
        .filter((category) => category !== "Modpacks")
        .map((category) => ({
          category,
          items: catalog
            .filter((item) =>
              item.type.toLowerCase().includes(category.toLowerCase().replace(" ", "")),
            )
            .slice(0, 6),
        })),
    [catalog, categories],
  );

  const featuredItem = popularModpacks[carouselIndex] ?? null;

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
    if (popularModpacks.length <= 1) {
      return;
    }
    const timer = window.setInterval(() => {
      nextCarousel();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [popularModpacks]);

  return (
    <section className="panel-view panel-view--news">
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

      {popularModpacks.length ? (
        <div className="news-section news-section--featured">
          <div className="news-section__header">
            <h3>Selección destacada</h3>
            <span className="news-section__meta">Inspirado en catálogo e-commerce</span>
          </div>
          {featuredItem ? (
            <div className="news-carousel news-carousel--featured">
              <button
                type="button"
                className="news-carousel__nav news-carousel__nav--prev"
                onClick={previousCarousel}
                aria-label="Anterior"
              >
                ‹
              </button>
              <article
                className="news-featured-card"
                onContextMenu={(event) => handleItemContextMenu(event, featuredItem)}
              >
                {featuredItem.thumbnail ? (
                  <img
                    className="news-featured-card__image"
                    src={featuredItem.thumbnail}
                    alt={featuredItem.name}
                  />
                ) : (
                  <div className="news-featured-card__image" />
                )}
                <div className="news-featured-card__content">
                  <p className="news-featured-card__kicker">Popular</p>
                  <h4>{featuredItem.name}</h4>
                  <p>{featuredItem.description}</p>
                  <div className="news-featured-card__stats">
                    <span>{featuredItem.source}</span>
                    <span>{featuredItem.author}</span>
                    <span>{featuredItem.downloads}</span>
                  </div>
                  <div className="news-featured-card__actions">
                    <button type="button" onClick={() => setSelectedItem(featuredItem)}>
                      Ver más
                    </button>
                    <button
                      type="button"
                      className="explorer-item__secondary"
                      onClick={() => setInstallItem(featuredItem)}
                    >
                      Instalar
                    </button>
                  </div>
                </div>
                <div className="news-featured-card__rail">
                  {popularModpacks.slice(0, 5).map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      className={index === carouselIndex ? "is-active" : ""}
                      onClick={() => setCarouselIndex(index)}
                    >
                      {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span>•</span>}
                      <span>{item.name}</span>
                    </button>
                  ))}
                </div>
              </article>
              <button
                type="button"
                className="news-carousel__nav news-carousel__nav--next"
                onClick={nextCarousel}
                aria-label="Siguiente"
              >
                ›
              </button>
            </div>
          ) : null}
          <div
            className="news-carousel__dots"
            role="tablist"
            aria-label="Modpacks populares"
          >
            {popularModpacks.map((item, index) => (
              <button
                key={`dot-${item.id}`}
                type="button"
                className={index === carouselIndex ? "is-active" : ""}
                onClick={() => setCarouselIndex(index)}
                aria-label={`Ver ${item.name}`}
              />
            ))}
          </div>
        </div>
      ) : null}

      {byCategory.map((entry) =>
        entry.items.length ? (
          <div className="news-section" key={entry.category}>
            <div className="news-section__header">
              <h3>{entry.category}</h3>
              <span className="news-section__meta">Categorías populares</span>
            </div>
            <div className="explorer-layout__cards">
              {entry.items.map((item) => (
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
                    <div className="explorer-item__icon" />
                  )}
                  <div className="explorer-item__info">
                    <h4>{item.name}</h4>
                    <p>{item.description}</p>
                    <div className="explorer-item__meta">
                      <span>{item.source}</span>
                      <span>{item.type}</span>
                    </div>
                  </div>
                  <div className="explorer-item__actions">
                    <button type="button" onClick={() => setSelectedItem(item)}>
                      Ver más
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
          </div>
        ) : null,
      )}

      {contextMenu ? (
        <div
          className="section-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <span className="section-context-menu__title">{contextMenu.item.name}</span>
          <button type="button" onClick={() => setSelectedItem(contextMenu.item)}>
            Ver detalles
          </button>
          <button type="button" onClick={() => setInstallItem(contextMenu.item)}>
            Instalar
          </button>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(contextMenu.item.name)}
          >
            Copiar nombre
          </button>
        </div>
      ) : null}

      {selectedItem ? (
        <ProductDetailsDialog
          item={selectedItem}
          details={details}
          loading={detailsLoading}
          onClose={() => setSelectedItem(null)}
          onInstall={(item) => setInstallItem(item)}
        />
      ) : null}

      {installItem ? (
        <ProductInstallDialog item={installItem} onClose={() => setInstallItem(null)} />
      ) : null}
    </section>
  );
};
