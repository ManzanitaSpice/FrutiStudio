interface ServerPanelProps {
  servers: Array<{
    id: string;
    name: string;
    address: string;
    lastSeen: string;
  }>;
}

export const ServerPanel = ({ servers }: ServerPanelProps) => {
  return (
    <section className="panel-view">
      <div className="panel-view__header">
        <div>
          <h2>Servers</h2>
          <p>Conecta rápidamente y sincroniza tus favoritos.</p>
        </div>
        <div className="panel-view__actions">
          <input type="search" placeholder="Buscar server..." />
          <button type="button">Agregar server</button>
        </div>
      </div>
      <div className="panel-view__list">
        {servers.map((server) => (
          <div key={server.id} className="list-item">
            <div>
              <h3>{server.name}</h3>
              <p>{server.address}</p>
            </div>
            <div className="list-item__meta">
              <span>Último acceso {server.lastSeen}</span>
              <div className="list-item__actions">
                <button type="button">Conectar</button>
                <button type="button">Editar</button>
                <button type="button">Borrar</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="panel-view__footer">
        <p className="panel-view__hint">
          Clic derecho sobre un server para abrir carpeta o copiar IP.
        </p>
      </div>
    </section>
  );
};
