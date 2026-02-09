import { type MouseEvent, useEffect, useMemo, useState } from "react";

import type { Instance } from "../../types/models";
import { formatPlaytime, formatRelativeTime } from "../../utils/formatters";

interface InstancePanelProps {
  instances: Instance[];
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

const creatorSections = [
  "Personalizado",
  "Importar",
  "ATLauncher",
  "CurseForge",
  "FTB Legacy",
  "Importar app de FTB",
  "Modrinth",
  "Technic",
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
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [activeEditorSection, setActiveEditorSection] = useState(
    editorSections[1],
  );
  const [activeCreatorSection, setActiveCreatorSection] = useState(
    creatorSections[0],
  );
  const [editorPosition, setEditorPosition] = useState({ x: 0, y: 0 });
  const [creatorPosition, setCreatorPosition] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    instance: Instance | null;
  } | null>(null);
  const selectedInstance =
    instances.find((instance) => instance.id === selectedInstanceId) ?? null;
  const toolbarActions =
    sectionToolbars[activeEditorSection] ?? sectionToolbars["Versión"];
  const statusLabels: Record<Instance["status"], string> = {
    ready: "Listo para jugar",
    "pending-update": "Actualización pendiente",
    stopped: "Detenida",
  };

  const versionRows = [
    { name: selectedInstance?.name ?? "Perfil principal", version: "3.3.3" },
    { name: "Minecraft", version: selectedInstance?.version ?? "1.21.1" },
    {
      name: selectedInstance?.loaderName ?? "Loader",
      version: selectedInstance?.loaderVersion ?? "—",
    },
  ];

  const groupedInstances = useMemo(() => {
    const groupMap = new Map<string, Instance[]>();
    instances.forEach((instance) => {
      const groupName =
        instance.group && instance.group.trim().length > 0
          ? instance.group
          : "No agrupado";
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, []);
      }
      groupMap.get(groupName)?.push(instance);
    });
    return Array.from(groupMap.entries());
  }, [instances]);

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      setEditorOpen(false);
    }
  };

  const handleCreatorBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      setCreatorOpen(false);
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

  const startCreatorDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (!creatorOpen) {
      return;
    }
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("button")
    ) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX - creatorPosition.x;
    const startY = event.clientY - creatorPosition.y;

    const handleMove = (moveEvent: MouseEvent) => {
      setCreatorPosition({
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

  const openCreator = () => {
    setCreatorOpen(true);
    setCreatorPosition({
      x: Math.max(32, window.innerWidth / 2 - 520),
      y: Math.max(24, window.innerHeight / 2 - 320),
    });
  };

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const handleClose = () => setContextMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("click", handleClose);
    window.addEventListener("contextmenu", handleClose);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("click", handleClose);
      window.removeEventListener("contextmenu", handleClose);
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

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
        <p>No hay datos disponibles para {activeEditorSection}.</p>
      </div>
    );
  };

  const renderCreatorBody = () => {
    if (activeCreatorSection === "Personalizado") {
      return (
        <div className="instance-creator__panel">
          <div className="instance-creator__field">
            <label htmlFor="instance-name">Nombre de la instancia</label>
            <input id="instance-name" type="text" placeholder="Ej: Mi mundo" />
          </div>
          <div className="instance-creator__field">
            <label htmlFor="instance-group">Grupo</label>
            <input id="instance-group" type="text" placeholder="No agrupado" />
          </div>
          <div className="instance-creator__field">
            <label htmlFor="instance-version">Versión de Minecraft</label>
            <select id="instance-version" defaultValue="1.21.1">
              <option value="1.21.1">1.21.1</option>
              <option value="1.20.4">1.20.4</option>
              <option value="1.19.4">1.19.4</option>
            </select>
          </div>
          <div className="instance-creator__field">
            <label htmlFor="instance-loader">Loader</label>
            <select id="instance-loader" defaultValue="NeoForge">
              <option value="NeoForge">NeoForge</option>
              <option value="Forge">Forge</option>
              <option value="Fabric">Fabric</option>
              <option value="Quilt">Quilt</option>
            </select>
          </div>
          <div className="instance-creator__hint">
            Configura una instancia limpia y agrega recursos más tarde.
          </div>
        </div>
      );
    }

    return (
      <div className="instance-creator__placeholder">
        <p>No hay resultados cargados para {activeCreatorSection}.</p>
        <span>Elige una fuente o busca para comenzar.</span>
      </div>
    );
  };

  const handleContextMenu = (
    event: MouseEvent<HTMLElement>,
    instance: Instance | null,
  ) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      instance,
    });
  };

  return (
    <section
      className="panel-view panel-view--instances"
      onClick={() => {
        if (selectedInstance) {
          onClearSelection();
        }
      }}
    >
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
          <button type="button" onClick={openCreator}>
            Crear instancia
          </button>
          <button type="button">Importar</button>
          <button
            type="button"
            className="panel-view__focus-toggle"
            onClick={onToggleFocusMode}
            aria-label={isFocusMode ? "Mostrar barras" : "Ocultar barras"}
            title={isFocusMode ? "Mostrar barras" : "Ocultar barras"}
          >
            {isFocusMode ? "⤢" : "⤡"}
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
        <div
          className="instances-layout__grid"
          onClick={onClearSelection}
          onContextMenu={(event) => handleContextMenu(event, null)}
        >
          {groupedInstances.map(([groupName, groupInstances]) => (
            <section key={groupName} className="instance-group">
              <header className="instance-group__header">
                <h3>{groupName}</h3>
                <span>{groupInstances.length} instancias</span>
              </header>
              <div className="instance-group__grid">
                {groupInstances.map((instance) => (
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
                    onContextMenu={(event) =>
                      handleContextMenu(event, instance)
                    }
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
                      <span>{groupName}</span>
                    </div>
                    <div className="instance-card__body">
                      <div>
                        <h3>{instance.name}</h3>
                        <p>Minecraft {instance.version}</p>
                        <p>
                          {instance.loaderName} {instance.loaderVersion}
                        </p>
                      </div>
                      <span className="instance-card__status">
                        {statusLabels[instance.status]}
                      </span>
                      <div className="instance-card__meta">
                        <span>{instance.mods} mods</span>
                        <span>{formatRelativeTime(instance.lastPlayed)}</span>
                        <span>{formatPlaytime(instance.playtime)}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
        {selectedInstance && (
          <aside className="instance-menu" onClick={(event) => event.stopPropagation()}>
            <>
              <div className="instance-menu__header">
                <div className="instance-menu__image" />
                <div>
                  <span className="instance-menu__launcher">FrutiLauncher</span>
                  <h3>{selectedInstance.name}</h3>
                  <p>Minecraft {selectedInstance.version}</p>
                  <span className="instance-menu__playtime">
                    Tiempo total: {formatPlaytime(selectedInstance.playtime)}
                  </span>
                </div>
              </div>
              <div className="instance-menu__scroll">
                <div className="instance-menu__section">
                  <h4>Acciones rápidas</h4>
                  <div className="instance-menu__actions">
                    <button type="button">Iniciar</button>
                    <button type="button" onClick={openEditor}>
                      Editar
                    </button>
                    <button type="button">Forzar cierre</button>
                    <button type="button">Crear atajo</button>
                  </div>
                </div>
                <div className="instance-menu__section">
                  <h4>Gestión de perfil</h4>
                  <div className="instance-menu__actions">
                    <button type="button">Cambiar grupo</button>
                    <button type="button">Exportar</button>
                    <button type="button">Duplicar</button>
                    <button type="button">Borrar</button>
                  </div>
                </div>
                <div className="instance-menu__section instance-menu__section--tools">
                  <h4>Herramientas</h4>
                  <div className="instance-menu__actions">
                    <button type="button">Abrir carpeta</button>
                    <button type="button">Ver logs</button>
                    <button type="button">Reparar instancia</button>
                    <button type="button">Limpiar cache</button>
                  </div>
                </div>
              </div>
            </>
          </aside>
        )}
      </div>
      {contextMenu && (
        <div
          className="instance-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.instance ? (
            <>
              <span className="instance-context-menu__title">
                {contextMenu.instance.name}
              </span>
              <button type="button">Iniciar</button>
              <button type="button" onClick={openEditor}>
                Editar
              </button>
              <button type="button">Abrir carpeta</button>
              <button type="button">Duplicar</button>
              <button type="button">Eliminar</button>
            </>
          ) : (
            <>
              <span className="instance-context-menu__title">
                Opciones del panel
              </span>
              <button type="button" onClick={openCreator}>
                Crear instancia
              </button>
              <button type="button">Importar instancia</button>
              <button type="button">Actualizar lista</button>
            </>
          )}
        </div>
      )}
      {creatorOpen && (
        <div className="instance-editor__backdrop" onClick={handleCreatorBackdropClick}>
          <div
            className="instance-creator"
            style={{ left: creatorPosition.x, top: creatorPosition.y }}
          >
            <header className="instance-creator__header" onMouseDown={startCreatorDrag}>
              <div>
                <h3>Nueva instancia</h3>
                <p>Elige el origen y configura tu perfil.</p>
              </div>
              <button type="button" onClick={() => setCreatorOpen(false)}>
                Cerrar
              </button>
            </header>
            <div className="instance-creator__body">
              <aside className="instance-creator__sidebar">
                {creatorSections.map((section) => (
                  <button
                    key={section}
                    type="button"
                    onClick={() => setActiveCreatorSection(section)}
                    className={
                      activeCreatorSection === section
                        ? "instance-creator__tab instance-creator__tab--active"
                        : "instance-creator__tab"
                    }
                  >
                    {section}
                  </button>
                ))}
              </aside>
              <div className="instance-creator__content">
                <div className="instance-creator__heading">
                  <div>
                    <h4>{activeCreatorSection}</h4>
                    <p>Configura o importa tu nueva instancia.</p>
                  </div>
                  <input type="search" placeholder="Buscar..." />
                </div>
                <div className="instance-creator__workspace">
                  {renderCreatorBody()}
                  <aside className="instance-creator__rail">
                    <h5>Acciones</h5>
                    <div className="instance-creator__actions">
                      <button type="button">Crear instancia</button>
                      <button type="button">Importar archivo</button>
                      <button type="button">Ver requisitos</button>
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
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
