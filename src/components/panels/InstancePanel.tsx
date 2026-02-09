interface InstancePanelProps {
  instances: Array<{
    id: string;
    name: string;
    version: string;
    mods: number;
    memory: string;
    status: string;
  }>;
}

export const InstancePanel = ({ instances }: InstancePanelProps) => {
  return (
    <section className="panel-view">
      <div className="panel-view__header">
        <div>
          <h2>Instancias</h2>
          <p>
            Ejecuta, edita y monitorea instancias con métricas en tiempo real.
          </p>
        </div>
        <div className="panel-view__actions">
          <input type="search" placeholder="Buscar instancia..." />
          <button type="button">Crear instancia</button>
          <button type="button">Importar</button>
        </div>
      </div>
      <div className="panel-view__grid">
        {instances.map((instance) => (
          <article key={instance.id} className="card">
            <div className="card__header">
              <div>
                <h3>{instance.name}</h3>
                <p>Minecraft {instance.version}</p>
              </div>
              <span className="card__status">{instance.status}</span>
            </div>
            <div className="card__body">
              <div>
                <strong>{instance.mods} mods</strong>
                <p>{instance.memory} asignados</p>
              </div>
              <div className="card__logs">
                <span>Último log:</span>
                <small>Sin errores críticos (hace 2 min)</small>
              </div>
            </div>
            <div className="card__actions">
              <button type="button">Ejecutar</button>
              <button type="button">Editar</button>
              <button type="button">Copiar</button>
              <button type="button">Backup</button>
            </div>
          </article>
        ))}
      </div>
      <div className="panel-view__footer">
        <div className="drop-zone">
          Arrastra mods o resource packs aquí para agregarlos a la instancia.
        </div>
        <p className="panel-view__hint">
          Tip: clic derecho sobre una instancia para abrir el menú contextual.
        </p>
      </div>
    </section>
  );
};
