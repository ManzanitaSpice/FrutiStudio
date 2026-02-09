const serverList = [
  {
    id: "catcraft",
    name: "CatCraft",
    ip: "forge.catcraft.net",
    players: "127/300",
    tags: ["Survival", "Towny", "PvE"],
  },
  {
    id: "talonmc",
    name: "TalonMC",
    ip: "play.talonmc.net",
    players: "1,276/2,025",
    tags: ["Prison", "SkyBlock", "OP"],
  },
  {
    id: "cobble",
    name: "CobbleGalaxy",
    ip: "cf.cobblegalaxy.com",
    players: "577/1,000",
    tags: ["Survival", "OP", "Super OP"],
  },
];

export const ServersPanel = () => {
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
          <span>Orden:</span>
          <select defaultValue="players">
            <option value="players">Jugadores activos</option>
            <option value="ping">Ping</option>
            <option value="recent">Recientes</option>
          </select>
        </div>
      </div>

      <div className="servers-list">
        {serverList.map((server) => (
          <article key={server.id} className="server-card">
            <div className="server-card__info">
              <div className="server-card__logo" />
              <div>
                <h3>{server.name}</h3>
                <p>{server.ip}</p>
                <div className="server-card__tags">
                  {server.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="server-card__meta">
              <span className="server-card__players">{server.players} jugando</span>
              <div className="server-card__actions">
                <button type="button">Ver</button>
                <button type="button" className="server-card__copy">
                  Copiar IP
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};
