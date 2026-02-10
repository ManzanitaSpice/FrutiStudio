import { useEffect, useState } from "react";

import { fetchServerListings, type ServerListing } from "../../services/serverService";

export const ServersPanel = () => {
  const [servers, setServers] = useState<ServerListing[]>([]);
  const [visibilityFilter, setVisibilityFilter] = useState("todos");
  const [orderFilter, setOrderFilter] = useState("players");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const parsePlayers = (value: string) => {
    const numeric = Number.parseInt(value.split("/")[0] ?? "0", 10);
    return Number.isNaN(numeric) ? 0 : numeric;
  };

  const filteredServers = servers
    .filter((server) => {
      if (visibilityFilter === "oficiales") {
        return server.official;
      }
      if (visibilityFilter === "comunidad") {
        return !server.official;
      }
      return true;
    })
    .slice()
    .sort((left, right) => {
      if (orderFilter === "players") {
        return parsePlayers(right.players) - parsePlayers(left.players);
      }
      if (orderFilter === "recent") {
        return left.name.localeCompare(right.name, "es", { sensitivity: "base" });
      }
      return 0;
    });

  return (
    <section className="panel-view panel-view--servers">
      <div className="panel-view__header">
        <div>
          <h2>Servers</h2>
          <p>
            Encuentra servidores por nombre o IP, con filtros avanzados y estado
            en tiempo real.
          </p>
        </div>
      </div>

      <div className="servers-toolbar">
        <div className="servers-toolbar__filters">
          <span>Modo:</span>
          <button type="button">Survival</button>
          <button type="button">SkyBlock</button>
          <button type="button">Creativo</button>
          <button type="button">PvP</button>
        </div>
        <div className="servers-toolbar__filters">
          <span>Visibilidad:</span>
          <button
            type="button"
            className={visibilityFilter === "todos" ? "is-active" : ""}
            onClick={() => setVisibilityFilter("todos")}
          >
            Todos
          </button>
          <button
            type="button"
            className={visibilityFilter === "oficiales" ? "is-active" : ""}
            onClick={() => setVisibilityFilter("oficiales")}
          >
            Oficiales
          </button>
          <button
            type="button"
            className={visibilityFilter === "comunidad" ? "is-active" : ""}
            onClick={() => setVisibilityFilter("comunidad")}
          >
            Comunidad
          </button>
        </div>
        <div className="servers-toolbar__filters">
          <span>Orden:</span>
          <select
            value={orderFilter}
            onChange={(event) => setOrderFilter(event.target.value)}
          >
            <option value="players">Jugadores activos</option>
            <option value="ping">Ping</option>
            <option value="recent">Recientes</option>
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
                <div className="server-card__logo" />
                <div>
                  <h3>{server.name}</h3>
                  <p>{server.ip}</p>
                  <div className="server-card__tags">
                    <span>{server.official ? "Oficial" : "Comunidad"}</span>
                    {server.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="server-card__meta">
                <span className="server-card__players">
                  {server.players} jugadores
                </span>
                <span className="server-card__status">{server.status}</span>
                <div className="server-card__actions">
                  <a href={server.website} target="_blank" rel="noreferrer">
                    Sitio oficial
                  </a>
                  <button type="button" className="server-card__copy">
                    Copiar IP
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : !loading && !error ? (
          <div className="servers-list__empty">
            <p>No hay servidores reales cargados.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
};
