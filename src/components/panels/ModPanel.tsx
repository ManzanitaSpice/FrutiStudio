interface ModPanelProps {
  mods: Array<{
    id: string;
    name: string;
    version: string;
    enabled: boolean;
  }>;
}

export const ModPanel = ({ mods }: ModPanelProps) => {
  return (
    <section className="panel-view">
      <div className="panel-view__header">
        <div>
          <h2>Mods</h2>
          <p>Activa, desactiva y actualiza mods por instancia.</p>
        </div>
        <div className="panel-view__actions">
          <input type="search" placeholder="Buscar mod..." />
          <button type="button">Actualizar todo</button>
          <button type="button">Agregar mod</button>
        </div>
      </div>
      <div className="panel-view__list">
        {mods.map((mod) => (
          <div key={mod.id} className="list-item">
            <div>
              <h3>{mod.name}</h3>
              <p>Versión {mod.version}</p>
            </div>
            <div className="list-item__meta">
              <span className={mod.enabled ? "tag tag--ok" : "tag"}>
                {mod.enabled ? "Activo" : "Inactivo"}
              </span>
              <div className="list-item__actions">
                <button type="button">
                  {mod.enabled ? "Desactivar" : "Activar"}
                </button>
                <button type="button">Configurar</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="panel-view__footer">
        <div className="drop-zone">
          Drag &amp; drop de mods para instalarlos al instante.
        </div>
      </div>
    </section>
  );
};
