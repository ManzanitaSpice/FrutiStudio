interface ModpackPanelProps {
  modpacks: Array<{
    id: string;
    name: string;
    source: string;
    version: string;
    status: string;
  }>;
}

export const ModpackPanel = ({ modpacks }: ModpackPanelProps) => {
  return (
    <section className="panel-view">
      <div className="panel-view__header">
        <div>
          <h2>Modpacks</h2>
          <p>
            Centraliza CurseForge, Modrinth y colecciones locales en un solo
            lugar.
          </p>
        </div>
        <div className="panel-view__actions">
          <input type="search" placeholder="Buscar modpack..." />
          <select aria-label="Filtrar por fuente">
            <option>Todos</option>
            <option>CurseForge</option>
            <option>Modrinth</option>
            <option>Local</option>
          </select>
          <button type="button">Descargar</button>
        </div>
      </div>
      <div className="panel-view__list">
        {modpacks.map((modpack) => (
          <div key={modpack.id} className="list-item">
            <div>
              <h3>{modpack.name}</h3>
              <p>
                {modpack.source} · Versión {modpack.version}
              </p>
            </div>
            <div className="list-item__meta">
              <span>{modpack.status}</span>
              <div className="list-item__actions">
                <button type="button">Actualizar</button>
                <button type="button">Eliminar</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="panel-view__footer">
        <p className="panel-view__hint">
          Preview instantáneo al pasar el mouse para ver descripción y changelog.
        </p>
      </div>
    </section>
  );
};
