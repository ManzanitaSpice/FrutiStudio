const sidebarActions = [
  { id: "add", label: "Añadir instancia" },
  { id: "folders", label: "Carpetas" },
  { id: "settings", label: "Ajustes" },
  { id: "help", label: "Ayuda (soporte)" },
  { id: "update", label: "Actualizar" },
];

export const Sidebar = () => {
  return (
    <aside className="sidebar">
      <div className="sidebar__section">
        <h3>Acciones rápidas</h3>
        <p>Atajos del panel principal.</p>
        <div className="sidebar__actions">
          {sidebarActions.map((action) => (
            <button key={action.id} type="button" className="sidebar__action">
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};
