interface ResourcesPanelProps {
  resources: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
  }>;
}

export const ResourcesPanel = ({ resources }: ResourcesPanelProps) => {
  return (
    <section className="panel-view">
      <div className="panel-view__header">
        <div>
          <h2>Recursos</h2>
          <p>Shaders y resource packs con vista previa y control rápido.</p>
        </div>
        <div className="panel-view__actions">
          <input type="search" placeholder="Buscar recursos..." />
          <button type="button">Importar pack</button>
        </div>
      </div>
      <div className="panel-view__grid">
        {resources.map((resource) => (
          <article key={resource.id} className="card card--resource">
            <div className="card__preview">{resource.type}</div>
            <div className="card__body">
              <h3>{resource.name}</h3>
              <p>{resource.status}</p>
            </div>
            <div className="card__actions">
              <button type="button">Activar</button>
              <button type="button">Preview</button>
            </div>
          </article>
        ))}
      </div>
      <div className="panel-view__footer">
        <div className="drop-zone">
          Suelta aquí tus shaders para instalarlos.
        </div>
      </div>
    </section>
  );
};
