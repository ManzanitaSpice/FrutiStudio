import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";

import { fetchServerListings, type ServerListing } from "../../services/serverService";

export const ServersPanel = () => {
  const [servers, setServers] = useState<ServerListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("all");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    server: ServerListing;
  } | null>(null);

  useEffect(() => {
    let isActive = true;
    const loadServers = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchServerListings(page, 12);
        if (isActive) {
          setServers((prev) => (page === 0 ? data.items : [...prev, ...data.items]));
          setHasMore(data.hasMore);
        }
      } catch (loadError) {
        if (isActive) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No se pudo conectar con los servidores oficiales.",
          );
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void loadServers();
    return () => {
      isActive = false;
    };
  }, [page]);

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

  const handleServerContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    server: ServerListing,
  ) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, server });
  };

  const filteredServers = useMemo(
    () =>
      servers.filter((server) => {
        const normalizedQuery = query.toLowerCase();
        const matchesQuery =
          !query.trim() ||
          server.name.toLowerCase().includes(normalizedQuery) ||
          server.ip.toLowerCase().includes(normalizedQuery) ||
          server.description.toLowerCase().includes(normalizedQuery);
        const matchesMode =
          mode === "all" ||
          server.tags.some((tag) => tag.toLowerCase() === mode) ||
          server.serverType.toLowerCase() === mode;
        return matchesQuery && matchesMode;
      }),
    [mode, query, servers],
  );

  return (
    <section className="panel-view panel-view--servers">
      <div className="servers-toolbar">
        <div className="servers-toolbar__filters">
          <input
            type="search"
            placeholder="Buscar por nombre, IP o descripción"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="servers-toolbar__filters">
          <span>Tipo:</span>
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="all">Todos</option>
            <option value="survival">Survival</option>
            <option value="skyblock">SkyBlock</option>
            <option value="pvp">PvP</option>
            <option value="minijuegos">Minijuegos</option>
            <option value="modded">Modded</option>
            <option value="multimodo">Multimodo</option>
          </select>
        </div>
      </div>

      <div className="servers-list">
        {loading ? <div className="servers-list__empty">Conectando...</div> : null}
        {error ? <div className="servers-list__empty">{error}</div> : null}
        {filteredServers.length ? (
          filteredServers.map((server) => (
            <article
              key={server.id}
              className="server-card"
              onContextMenu={(event) => handleServerContextMenu(event, server)}
            >
              <div className="server-card__info">
                <img
                  className="server-card__logo"
                  src={server.banner}
                  alt={server.name}
                />
                <div>
                  <h3>{server.name}</h3>
                  <p>{server.ip}</p>
                  <p className="server-card__description">{server.description}</p>
                  <div className="server-card__tags">
                    {server.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="server-card__meta">
                <span className="server-card__players">👥 {server.players} en línea</span>
                <span className="server-card__status">{server.status}</span>
                <span className="server-card__version">Versión {server.version}</span>
                <span className="server-card__type">Tipo: {server.serverType}</span>
                <div className="server-card__actions">
                  <a href={server.website} target="_blank" rel="noreferrer">
                    Sitio oficial
                  </a>
                  <button
                    type="button"
                    className="server-card__copy"
                    onClick={() => navigator.clipboard.writeText(server.ip)}
                  >
                    Copiar IP
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : !loading && !error ? (
          <div className="servers-list__empty">
            <p>No hay servidores para ese filtro.</p>
          </div>
        ) : null}
      </div>

      {contextMenu ? (
        <div
          className="section-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <span className="section-context-menu__title">{contextMenu.server.name}</span>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(contextMenu.server.ip)}
          >
            Copiar IP
          </button>
          <button
            type="button"
            onClick={() =>
              window.open(contextMenu.server.website, "_blank", "noopener,noreferrer")
            }
          >
            Abrir sitio
          </button>
          <button
            type="button"
            onClick={() =>
              navigator.clipboard.writeText(`/join ${contextMenu.server.ip}`)
            }
          >
            Copiar comando /join
          </button>
        </div>
      ) : null}

      {hasMore ? (
        <button
          type="button"
          className="explorer-item__secondary"
          onClick={() => setPage((prev) => prev + 1)}
        >
          Cargar más servidores
        </button>
      ) : null}
    </section>
  );
};
