import { type MouseEvent, useState } from "react";

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
    playtime: string;
  }>;
  selectedInstanceId: string | null;
  onSelectInstance: (id: string) => void;
  onClearSelection: () => void;
  isFocusMode: boolean;
  onToggleFocusMode: () => void;
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
  onClearSelection,
  isFocusMode,
  onToggleFocusMode,
}: InstancePanelProps) => {
  const [editorOpen, setEditorOpen] = useState(false);
  const [activeEditorSection, setActiveEditorSection] = useState(
    editorSections[1],
  );
  const [editorPosition, setEditorPosition] = useState({ x: 0, y: 0 });
  const selectedInstance =
    instances.find((instance) => instance.id === selectedInstanceId) ?? null;
  const toolbarActions =
    sectionToolbars[activeEditorSection] ?? sectionToolbars["Versión"];

  const versionRows = [
    { name: selectedInstance?.name ?? "Perfil principal", version: "3.3.3" },
    { name: "Minecraft", version: selectedInstance?.version ?? "1.21.1" },
    { name: "NeoForge", version: "21.1.218" },
  ];

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      setEditorOpen(false);
    }
  };

  const startDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (!editorOpen) {
      return;
    }
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("button")
    ) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX - editorPosition.x;
    const startY = event.clientY - editorPosition.y;

    const handleMove = (moveEvent: MouseEvent) => {
      setEditorPosition({
        x: moveEvent.clientX - startX,
        y: moveEvent.clientY - startY,
      });
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const openEditor = () => {
    setEditorOpen(true);
    setEditorPosition({
      x: Math.max(32, window.innerWidth / 2 - 520),
      y: Math.max(24, window.innerHeight / 2 - 320),
    });
  };

  const renderEditorBody = () => {
    if (activeEditorSection === "Versión") {
      return (
        <div className="instance-editor__table">
          <div className="instance-editor__table-header">
            <span>Nombre</span>
            <span>Versión</span>
          </div>
          {versionRows.map((row) => (
            <div key={row.name} className="instance-editor__table-row">
              <span>{row.name}</span>
              <span>{row.version}</span>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="instance-editor__placeholder">
        <p>Contenido de {activeEditorSection} en preparación.</p>
      </div>
    );
  };

  return (
    <section className="panel-view panel-view--instances">
      {isFocusMode && (
        <div className="instance-panel__commandbar">
          <div className="instance-panel__commandbar-left">
            <button type="button">+ Crear</button>
            <button type="button">Importar</button>
            <button type="button">Crear grupo</button>
          </div>
          <div className="instance-panel__commandbar-right">
            <button type="button" aria-label="Buscar">
              🔍
            </button>
            <button type="button" aria-label="Descargas">
              ⬇️
            </button>
            <button type="button" aria-label="Filtros">
              ⚙️
            </button>
            <button type="button" aria-label="Vista">
              ⬚
            </button>
          </div>
        </div>
      )}
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
          <button
            type="button"
            className="panel-view__focus-toggle"
            onClick={onToggleFocusMode}
          >
            {isFocusMode ? "Mostrar barras" : "Ocultar barras"}
          </button>
        </div>
      </div>
      <div
        className={
          selectedInstance
            ? "instances-layout"
            : "instances-layout instances-layout--single"
        }
      >
        <div className="instances-layout__grid" onClick={onClearSelection}>
          {instances.map((instance) => (
            <article
              key={instance.id}
              className={
                selectedInstanceId === instance.id
                  ? "instance-card instance-card--active"
                  : "instance-card"
              }
              onClick={(event) => {
                event.stopPropagation();
                onSelectInstance(instance.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectInstance(instance.id);
                }
              }}
              role="button"
              tabIndex={0}
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
        {selectedInstance && (
          <aside className="instance-menu">
            <>
              <div className="instance-menu__preview">
                <div className="instance-menu__image" />
                <div>
                  <h3>{selectedInstance.name}</h3>
                  <p>Minecraft {selectedInstance.version}</p>
                  <span className="instance-menu__playtime">
                    Tiempo total: {selectedInstance.playtime}
                  </span>
                </div>
              </div>
              <div className="instance-menu__section">
                <h4>Opciones de instancia</h4>
                <div className="instance-menu__actions">
                  <button type="button">Iniciar</button>
                  <button type="button">Forzar cierre</button>
                  <button type="button" onClick={openEditor}>
                    Editar
                  </button>
                  <button type="button">Cambiar grupo</button>
                  <button type="button">Exportar</button>
                  <button type="button">Copiar</button>
                  <button type="button">Borrar</button>
                  <button type="button">Crear atajo</button>
                </div>
              </div>
              <div className="instance-menu__section instance-menu__section--global">
                <h4>Ajustes globales</h4>
                <div className="instance-menu__actions">
                  <button type="button">Cuentas</button>
                  <button type="button">Java &amp; memoria</button>
                  <button type="button">Temas</button>
                  <button type="button">Red y descargas</button>
                  <button type="button">Plugins</button>
                </div>
              </div>
            </>
          </aside>
        )}
      </div>
      {editorOpen && selectedInstance && (
        <div className="instance-editor__backdrop" onClick={handleBackdropClick}>
          <div
            className="instance-editor"
            style={{ left: editorPosition.x, top: editorPosition.y }}
          >
            <header className="instance-editor__header" onMouseDown={startDrag}>
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
                <div className="instance-editor__heading">
                  <div>
                    <h4>{activeEditorSection}</h4>
                    <p>Gestiona esta sección con herramientas avanzadas.</p>
                  </div>
                  <input type="search" placeholder="Buscar en la sección..." />
                </div>
                <div className="instance-editor__workspace">
                  <div className="instance-editor__panel">{renderEditorBody()}</div>
                  <aside className="instance-editor__rail">
                    <h5>Herramientas</h5>
                    <div className="instance-editor__actions">
                      {toolbarActions.map((action) => (
                        <button key={action} type="button">
                          {action}
                        </button>
                      ))}
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
