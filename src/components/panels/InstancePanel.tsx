import { useState } from "react";

interface InstancePanelProps {
  instances: Array<{
    id: string;
    name: string;
    version: string;
    mods: number;
    memory: string;
    status: string;
    group: string;
    lastPlayed: string;
  }>;
  selectedInstanceId: string | null;
  onSelectInstance: (id: string) => void;
}

const editorSections = [
  "Registro de Minecraft",
  "Versión",
  "Mods",
  "Resource Packs",
  "Shader Packs",
  "Notas",
  "Mundos",
  "Servidores",
  "Capturas de pantalla",
  "Configuración",
  "Otros registros",
];

const sectionToolbars: Record<string, string[]> = {
  "Registro de Minecraft": ["Pausar", "Limpiar", "Guardar log"],
  "Versión": [
    "Cambiar versión",
    "Remover",
    "Personalizar",
    "Editar",
    "Revertir",
    "Instalar loader",
    "Añadir a minecraft.jar",
    "Sustituir minecraft.jar",
    "Añadir agentes",
    "Añadir vacío",
    "Importar componentes",
    "Abrir .minecraft",
    "Añadir librerías",
  ],
  Mods: ["Descargar mods", "Buscar actualizaciones", "Cambiar versión"],
  "Resource Packs": ["Añadir", "Activar", "Importar", "Abrir carpeta"],
  "Shader Packs": ["Añadir", "Activar", "Importar", "Abrir carpeta"],
  Notas: ["Nueva nota", "Compartir", "Exportar"],
  Mundos: ["Añadir", "Importar", "Respaldar", "Abrir carpeta"],
  Servidores: ["Añadir servidor", "Editar", "Importar", "Exportar"],
  "Capturas de pantalla": ["Abrir carpeta", "Importar", "Compartir"],
  Configuración: ["Restaurar", "Exportar", "Aplicar perfil"],
  "Otros registros": ["Filtrar", "Exportar", "Limpiar"],
};

export const InstancePanel = ({
  instances,
  selectedInstanceId,
  onSelectInstance,
}: InstancePanelProps) => {
  const [editorOpen, setEditorOpen] = useState(false);
  const [activeEditorSection, setActiveEditorSection] = useState(
    editorSections[1],
  );
  const selectedInstance =
    instances.find((instance) => instance.id === selectedInstanceId) ?? null;
  const toolbarActions =
    sectionToolbars[activeEditorSection] ?? sectionToolbars["Versión"];

  return (
    <section className="panel-view panel-view--instances">
      <div className="panel-view__header">
        <div>
          <h2>Instancias instaladas</h2>
          <p>
            Gestiona tus modpacks, grupos y versiones desde una sola vista
            central.
          </p>
        </div>
        <div className="panel-view__actions">
          <input type="search" placeholder="Buscar instancia..." />
          <button type="button">Crear instancia</button>
          <button type="button">Importar</button>
        </div>
      </div>
      <div className="instances-layout">
        <div className="instances-layout__grid">
          {instances.map((instance) => (
            <article
              key={instance.id}
              className={
                selectedInstanceId === instance.id
                  ? "instance-card instance-card--active"
                  : "instance-card"
              }
              onClick={() => onSelectInstance(instance.id)}
            >
              <div className="instance-card__cover">
                <span>{instance.group}</span>
              </div>
              <div className="instance-card__body">
                <div>
                  <h3>{instance.name}</h3>
                  <p>Minecraft {instance.version}</p>
                </div>
                <span className="instance-card__status">{instance.status}</span>
                <div className="instance-card__meta">
                  <span>{instance.mods} mods</span>
                  <span>{instance.memory}</span>
                  <span>{instance.lastPlayed}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
        <aside className="instance-menu">
          {selectedInstance ? (
            <>
              <div className="instance-menu__preview">
                <div className="instance-menu__image" />
                <div>
                  <h3>{selectedInstance.name}</h3>
                  <p>Minecraft {selectedInstance.version}</p>
                </div>
              </div>
              <div className="instance-menu__actions">
                <button type="button">Iniciar</button>
                <button type="button">Forzar cierre</button>
                <button type="button" onClick={() => setEditorOpen(true)}>
                  Editar
                </button>
                <button type="button">Cambiar grupo</button>
                <button type="button">Exportar</button>
                <button type="button">Copiar</button>
                <button type="button">Borrar</button>
                <button type="button">Crear atajo</button>
              </div>
            </>
          ) : (
            <div className="instance-menu__empty">
              <p>Selecciona una instancia en la barra lateral.</p>
            </div>
          )}
        </aside>
      </div>
      {editorOpen && selectedInstance && (
        <div className="instance-editor__backdrop">
          <div className="instance-editor">
            <header className="instance-editor__header">
              <div>
                <h3>Editar {selectedInstance.name}</h3>
                <p>Minecraft {selectedInstance.version}</p>
              </div>
              <button type="button" onClick={() => setEditorOpen(false)}>
                Cerrar
              </button>
            </header>
            <div className="instance-editor__body">
              <aside className="instance-editor__sidebar">
                {editorSections.map((section) => (
                  <button
                    key={section}
                    type="button"
                    onClick={() => setActiveEditorSection(section)}
                    className={
                      activeEditorSection === section
                        ? "instance-editor__tab instance-editor__tab--active"
                        : "instance-editor__tab"
                    }
                  >
                    {section}
                  </button>
                ))}
              </aside>
              <div className="instance-editor__content">
                <div className="instance-editor__toolbar">
                  <h4>{activeEditorSection}</h4>
                  <div className="instance-editor__actions">
                    {toolbarActions.map((action) => (
                      <button key={action} type="button">
                        {action}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="instance-editor__panel">
                  <p>
                    Panel de {activeEditorSection} para {selectedInstance.name}.
                  </p>
                  <div className="instance-editor__placeholder" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
