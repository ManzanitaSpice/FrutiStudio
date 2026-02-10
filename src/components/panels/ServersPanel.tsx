import { useEffect, useMemo, useState } from "react";

import { fetchServerListings, type ServerListing } from "../../services/serverService";

export const ServersPanel = () => {
  const [servers, setServers] = useState<ServerListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("all");

  useEffect(() => {
    let isActive = true;
    const loadServers = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchServerListings();
        if (isActive) {
          setServers(data);
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
  }, []);

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
      <div className="panel-view__header">
        <div>
          <h2>Servers</h2>
          <p>
            Catálogo real con estado, versión, tipo y tarjetas visuales para descubrir
            servidores.
          </p>
        </div>
      </div>

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
            <article key={server.id} className="server-card">
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
                <span className="server-card__players">{server.players} jugadores</span>
                <span className="server-card__status">{server.status}</span>
                <span className="server-card__version">{server.version}</span>
                <span className="server-card__type">{server.serverType}</span>
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
    </section>
  );
};
