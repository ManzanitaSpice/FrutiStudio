import type { SectionKey } from "./Toolbar";

interface SidebarProps {
  current: SectionKey;
  onSelect: (section: SectionKey) => void;
}

const sections: Array<{
  key: SectionKey;
  title: string;
  description: string;
}> = [
  {
    key: "instancias",
    title: "Instancias",
    description: "Gestiona mundos, versiones y rendimiento.",
  },
  {
    key: "modpacks",
    title: "Modpacks",
    description: "Descarga, actualiza y comparte colecciones.",
  },
  {
    key: "mods",
    title: "Mods",
    description: "Control total con activar/desactivar rápido.",
  },
  {
    key: "servers",
    title: "Servers",
    description: "Conecta y sincroniza listas favoritas.",
  },
  {
    key: "recursos",
    title: "Recursos",
    description: "Shaders y resource packs con previews.",
  },
];

export const Sidebar = ({ current, onSelect }: SidebarProps) => {
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <h2>Secciones</h2>
        <p>Personaliza el orden con drag &amp; drop.</p>
      </div>
      <ul className="sidebar__list">
        {sections.map((section) => (
          <li key={section.key}>
            <button
              type="button"
              className={
                current === section.key
                  ? "sidebar__item sidebar__item--active"
                  : "sidebar__item"
              }
              onClick={() => onSelect(section.key)}
            >
              <span>{section.title}</span>
              <small>{section.description}</small>
            </button>
          </li>
        ))}
      </ul>
      <div className="sidebar__footer">
        <h3>Atajos rápidos</h3>
        <div className="sidebar__chips">
          <span>⚡ Ejecutar última instancia</span>
          <span>🧰 Abrir carpeta base</span>
          <span>🔔 Notificaciones</span>
        </div>
      </div>
    </aside>
  );
};
