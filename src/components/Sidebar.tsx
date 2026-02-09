interface SidebarProps {
  instances: Array<{
    id: string;
    name: string;
    version: string;
    group: string;
  }>;
  selectedInstanceId: string | null;
  onSelectInstance: (id: string) => void;
}

const sidebarActions = [
  { id: "add", label: "Añadir instancia" },
  { id: "folders", label: "Carpetas" },
  { id: "settings", label: "Ajustes" },
  { id: "help", label: "Ayuda (soporte)" },
  { id: "update", label: "Actualizar" },
];

export const Sidebar = ({
  instances,
  selectedInstanceId,
  onSelectInstance,
}: SidebarProps) => {
  const groups = Array.from(new Set(instances.map((instance) => instance.group)));
  return (
    <aside className="sidebar">
      <div className="sidebar__section">
        <h2>Launcher</h2>
        <p>Acciones rápidas del panel principal.</p>
        <div className="sidebar__actions">
          {sidebarActions.map((action) => (
            <button key={action.id} type="button" className="sidebar__action">
              {action.label}
            </button>
          ))}
        </div>
      </div>
      <div className="sidebar__section sidebar__section--instances">
        <div className="sidebar__section-header">
          <h3>Instancias instaladas</h3>
          <span>{instances.length} activas</span>
        </div>
        {groups.map((group) => (
          <div key={group} className="sidebar__group">
            <span className="sidebar__group-title">{group}</span>
            <ul className="sidebar__instance-list">
              {instances
                .filter((instance) => instance.group === group)
                .map((instance) => (
                  <li key={instance.id}>
                    <button
                      type="button"
                      onClick={() => onSelectInstance(instance.id)}
                      className={
                        selectedInstanceId === instance.id
                          ? "sidebar__instance sidebar__instance--active"
                          : "sidebar__instance"
                      }
                    >
                      <span>{instance.name}</span>
                      <small>Minecraft {instance.version}</small>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
};
