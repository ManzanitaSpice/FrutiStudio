import steveSkin from "../assets/steve.svg";
import type { FeatureFlags } from "../types/models";
import { useI18n } from "../i18n/useI18n";
import type { ThemePreference } from "../context/UIContext";

export type SectionKey =
  | "mis-modpacks"
  | "novedades"
  | "explorador"
  | "servers"
  | "configuracion";

interface ToolbarProps {
  current: SectionKey;
  onSelect: (section: SectionKey) => void;
  showGlobalSearch: boolean;
  flags: FeatureFlags;
  onThemeChange: (theme: ThemePreference) => void;
  theme: ThemePreference;
}

export const Toolbar = ({
  current,
  onSelect,
  showGlobalSearch,
  flags,
  onThemeChange,
  theme,
}: ToolbarProps) => {
  const { t } = useI18n();
  const navItems: Array<{ key: SectionKey; label: string; enabled: boolean }> =
    [
      { key: "mis-modpacks", label: t("sections").modpacks, enabled: true },
      { key: "novedades", label: t("sections").news, enabled: flags.news },
      {
        key: "explorador",
        label: t("sections").explorer,
        enabled: flags.explorer,
      },
      { key: "servers", label: t("sections").servers, enabled: flags.servers },
      {
        key: "configuracion",
        label: t("sections").settings,
        enabled: flags.settings,
      },
    ];
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
        <nav className="topbar__nav" aria-label="Navegación principal">
          {navItems
            .filter((item) => item.enabled)
            .map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect(item.key)}
                className={
                  current === item.key
                    ? "topbar__button topbar__button--active"
                    : "topbar__button"
                }
                aria-current={current === item.key ? "page" : undefined}
              >
                {item.label}
              </button>
            ))}
          <select
            aria-label="Tema"
            value={theme}
            onChange={(event) =>
              onThemeChange(event.target.value as ThemePreference)
            }
          >
            <option value="system">Sistema</option>
            <option value="light">Claro</option>
            <option value="dark">Oscuro</option>
          </select>
        </nav>
      </div>
    </header>
  );
};
