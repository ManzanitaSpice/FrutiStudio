import steveSkin from "../assets/steve.svg";

export type SectionKey =
  | "mis-modpacks"
  | "novedades"
  | "explorador"
  | "servers";

interface ToolbarProps {
  current: SectionKey;
  onSelect: (section: SectionKey) => void;
  showGlobalSearch: boolean;
}

const navItems: Array<{ key: SectionKey; label: string }> = [
  { key: "mis-modpacks", label: "Mis Modpacks" },
  { key: "novedades", label: "Novedades" },
  { key: "explorador", label: "Explorador" },
  { key: "servers", label: "Servers" },
];

export const Toolbar = ({ current, onSelect, showGlobalSearch }: ToolbarProps) => {
  const account = {
    name: "ManzanitaSpace",
    skinUrl: null as string | null,
  };

  const skinSource = account.skinUrl ?? steveSkin;

  return (
    <header className="topbar">
      <div className="topbar__row topbar__row--main">
        <div className="topbar__brand">
          <span className="topbar__logo">🍓</span>
          <div>
            <strong>FrutiStudio</strong>
            <small>Launcher</small>
          </div>
        </div>
        <div className="topbar__status">
          <span>Sesión activa</span>
          <div className="topbar__account">
            <img src={skinSource} alt="Skin del jugador" />
            <strong>{account.name}</strong>
          </div>
        </div>
        <div className="topbar__window-controls">
          <button type="button" title="Minimizar">
            —
          </button>
          <button type="button" title="Ventana">
            ☐
          </button>
          <button type="button" title="Pantalla completa">
            ⤢
          </button>
        </div>
      </div>
      <div className="topbar__row topbar__row--nav">
        {showGlobalSearch && (
          <label className="topbar__search">
            <span>🔍</span>
            <input
              type="search"
              placeholder="Buscar en novedades, explorador y servers..."
            />
            <button type="button" aria-label="Limpiar búsqueda">
              ✕
            </button>
          </label>
        )}
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
      </div>
    </header>
  );
};
