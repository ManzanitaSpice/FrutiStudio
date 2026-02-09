export type SectionKey =
  | "mis-modpacks"
  | "novedades"
  | "explorador"
  | "servers";

interface ToolbarProps {
  current: SectionKey;
  onSelect: (section: SectionKey) => void;
}

const navItems: Array<{ key: SectionKey; label: string }> = [
  { key: "mis-modpacks", label: "Mis Modpacks" },
  { key: "novedades", label: "Novedades" },
  { key: "explorador", label: "Explorador" },
  { key: "servers", label: "Servers" },
];

export const Toolbar = ({ current, onSelect }: ToolbarProps) => {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__logo">🍓</span>
        <div>
          <strong>FrutiStudio</strong>
          <small>Launcher</small>
        </div>
      </div>
      <nav className="topbar__nav">
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            className={
              current === item.key
                ? "topbar__button topbar__button--active"
                : "topbar__button"
            }
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="topbar__status">
        <span>Sesión activa</span>
        <strong>ManzanitaSpace</strong>
      </div>
    </header>
  );
};
