import { SelectFolderButton } from "./SelectFolderButton";

export type SectionKey =
  | "instancias"
  | "modpacks"
  | "mods"
  | "servers"
  | "recursos";

interface ToolbarProps {
  current: SectionKey;
  onSelect: (section: SectionKey) => void;
}

const navItems: Array<{ key: SectionKey; label: string }> = [
  { key: "instancias", label: "Instancias" },
  { key: "modpacks", label: "Modpacks" },
  { key: "mods", label: "Mods" },
  { key: "servers", label: "Servers" },
  { key: "recursos", label: "Recursos" },
];

export const Toolbar = ({ current, onSelect }: ToolbarProps) => {
  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <div className="toolbar__logo">🍓</div>
        <div>
          <h1>FrutiStudio</h1>
          <p>Launcher todo-en-uno para instancias, mods y recursos.</p>
        </div>
      </div>
      <nav className="toolbar__nav">
        <button type="button" className="toolbar__button">
          Archivo
        </button>
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            className={
              current === item.key
                ? "toolbar__button toolbar__button--active"
                : "toolbar__button"
            }
          >
            {item.label}
          </button>
        ))}
        <button type="button" className="toolbar__button">
          Configuración
        </button>
        <button type="button" className="toolbar__button">
          Logs
        </button>
        <button type="button" className="toolbar__button">
          Ayuda
        </button>
      </nav>
      <div className="toolbar__actions">
        <div className="toolbar__quick-actions">
          <button type="button">Nueva instancia</button>
          <button type="button">Buscar actualizaciones</button>
        </div>
        <div className="toolbar__base-dir">
          <SelectFolderButton />
        </div>
      </div>
    </header>
  );
};
