import { useEffect, useRef, useState } from "react";

import steveSkin from "../assets/steve.svg";
import type { FeatureFlags } from "../types/models";
import { useI18n } from "../i18n/useI18n";

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
  isFocusMode: boolean;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}

export const Toolbar = ({
  current,
  onSelect,
  showGlobalSearch,
  flags,
  isFocusMode,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
}: ToolbarProps) => {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!menuRef.current) {
        return;
      }
      if (!(event.target instanceof Node)) {
        return;
      }
      if (!menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  return (
    <header className="topbar">
      <div className="topbar__row topbar__row--utility">
        <div className="topbar__utility-left">
          <div className="topbar__brand" aria-label="FrutiLauncher">
            <span className="topbar__brand-icon" aria-hidden="true" />
            <span className="topbar__brand-name">FrutiLauncher</span>
          </div>
          <div className="topbar__nav-controls" role="group" aria-label="Historial">
            <button
              type="button"
              aria-label="Volver"
              onClick={onBack}
              disabled={!canGoBack}
            >
              ←
            </button>
            <button
              type="button"
              aria-label="Avanzar"
              onClick={onForward}
              disabled={!canGoForward}
            >
              →
            </button>
          </div>
        </div>
      </div>
      {!isFocusMode && (
        <div className="topbar__row topbar__row--main">
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
          </nav>
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
          <div className="topbar__account" ref={menuRef}>
            <button
              type="button"
              className="topbar__account-trigger"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <img src={skinSource} alt="Skin del jugador" />
              <span className="topbar__account-name">{account.name}</span>
              <span aria-hidden="true" className="topbar__account-caret">
                ▾
              </span>
            </button>
            {menuOpen && (
              <div className="topbar__account-menu" role="menu">
                <button
                  type="button"
                  className="topbar__account-item topbar__account-item--active"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="topbar__account-check">✓</span>
                  <span>{account.name}</span>
                  <span className="topbar__account-shortcut">Ctrl + 1</span>
                </button>
                <button
                  type="button"
                  className="topbar__account-item"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="topbar__account-check" />
                  <span>No hay cuenta por defecto</span>
                  <span className="topbar__account-shortcut">Ctrl + 0</span>
                </button>
                <button
                  type="button"
                  className="topbar__account-item topbar__account-item--footer"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  Administrar cuentas...
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
