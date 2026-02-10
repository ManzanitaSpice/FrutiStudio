import { useEffect, useMemo, useState } from "react";

import { ProductDetailsDialog, ProductInstallDialog } from "../ProductDialogs";
import {
  type NewsOverview,
  fetchNewsOverview,
} from "../../services/newsService";
import { type ExplorerItem, fetchExplorerItemDetails, type ExplorerItemDetails } from "../../services/explorerService";

export const NewsPanel = () => {
  const [news, setNews] = useState<NewsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ExplorerItem | null>(null);
  const [details, setDetails] = useState<ExplorerItemDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [installItem, setInstallItem] = useState<ExplorerItem | null>(null);
  const [spotlightIndex, setSpotlightIndex] = useState(0);

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

  const byCategory = useMemo(
    () =>
      categories.map((category) => ({
        category,
        items: catalog.filter((item) => item.type.toLowerCase().includes(category.toLowerCase().replace(" ", ""))).slice(0, 6),
      })),
    [catalog, categories],
  );

  useEffect(() => {
    if ((news?.trendingItems?.length ?? 0) <= 1) {
      return;
    }
    const timer = window.setInterval(() => {
      setSpotlightIndex((prev) =>
        news?.trendingItems?.length ? (prev + 1) % news.trendingItems.length : 0,
      );
    }, 4200);
    return () => window.clearInterval(timer);
  }, [news?.trendingItems?.length]);

  const spotlight = news?.trendingItems?.[spotlightIndex];
  const spotlightProject = catalog.find((entry) => entry.id === spotlight?.id);

  return (
    <section className="panel-view panel-view--news">
      <div className="panel-view__header">
        <div>
          <h2>Novedades</h2>
          <p>Catálogo completo con ranking por relevancia, categorías activas y acceso directo a detalle e instalación.</p>
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

      {spotlight && spotlightProject ? (
        <div className="news-section">
          <div className="news-section__header">
            <h3>Destacado del momento</h3>
            <span className="news-section__meta">Actualización automática</span>
          </div>
          <article className="explorer-item explorer-item--card">
            {spotlight.thumbnail ? <img className="explorer-item__icon" src={spotlight.thumbnail} alt={spotlight.title} /> : <div className="explorer-item__icon" />}
            <div className="explorer-item__info">
              <h4>{spotlight.title}</h4>
              <p>{spotlightProject.description}</p>
              <div className="explorer-item__meta">
                <span>{spotlightProject.source}</span>
                <span>{spotlightProject.type}</span>
                <span>{spotlightProject.downloads}</span>
              </div>
            </div>
            <div className="explorer-item__actions">
              <button type="button" onClick={() => setSelectedItem(spotlightProject)}>Ver más</button>
              <button type="button" className="explorer-item__secondary" onClick={() => setInstallItem(spotlightProject)}>Instalar</button>
            </div>
          </article>
        </div>
      ) : null}

      <div className="news-section">
        <div className="news-section__header">
          <h3>Ranking por relevancia</h3>
          <span className="news-section__meta">Top global</span>
        </div>
        <div className="explorer-layout__cards">
          {(news?.trendingItems ?? []).map((item) => {
            const project = catalog.find((entry) => entry.id === item.id);
            if (!project) return null;
            return (
              <article key={item.id} className="explorer-item explorer-item--card">
                {item.thumbnail ? <img className="explorer-item__icon" src={item.thumbnail} alt={item.title} /> : <div className="explorer-item__icon" />}
                <div className="explorer-item__info">
                  <h4>{item.title}</h4>
                  <p>{project.description}</p>
                  <div className="explorer-item__meta">
                    <span>{project.type}</span>
                    <span>{project.author}</span>
                    <span>{project.downloads}</span>
                  </div>
                </div>
                <div className="explorer-item__actions">
                  <button type="button" onClick={() => setSelectedItem(project)}>Ver más</button>
                  <button type="button" className="explorer-item__secondary" onClick={() => setInstallItem(project)}>Instalar</button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {byCategory.map((entry) => (
        entry.items.length ? (
          <div className="news-section" key={entry.category}>
            <div className="news-section__header">
              <h3>{entry.category}</h3>
              <span className="news-section__meta">Categorías populares</span>
            </div>
            <div className="explorer-layout__cards">
              {entry.items.map((item) => (
                <article key={item.id} className="explorer-item explorer-item--card">
                  {item.thumbnail ? <img className="explorer-item__icon" src={item.thumbnail} alt={item.name} /> : <div className="explorer-item__icon" />}
                  <div className="explorer-item__info">
                    <h4>{item.name}</h4>
                    <p>{item.description}</p>
                    <div className="explorer-item__meta">
                      <span>{item.source}</span>
                      <span>{item.type}</span>
                    </div>
                  </div>
                  <div className="explorer-item__actions">
                    <button type="button" onClick={() => setSelectedItem(item)}>Ver más</button>
                    <button type="button" className="explorer-item__secondary" onClick={() => setInstallItem(item)}>Instalar</button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null
      ))}

      {selectedItem ? (
        <ProductDetailsDialog
          item={selectedItem}
          details={details}
          loading={detailsLoading}
          onClose={() => setSelectedItem(null)}
          onInstall={(item) => setInstallItem(item)}
        />
      ) : null}

      {installItem ? <ProductInstallDialog item={installItem} onClose={() => setInstallItem(null)} /> : null}
    </section>
  );
};
