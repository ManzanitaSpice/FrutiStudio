import { useEffect, useMemo, useRef, useState } from "react";

import steveSkin from "../assets/steve.svg";
import type { FeatureFlags } from "../types/models";
import { useI18n } from "../i18n/useI18n";
import { fetchInstances } from "../services/instanceService";
import { fetchUnifiedCatalog } from "../services/explorerService";

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
  onSearchSubmit: (query: string) => void;
}

interface SearchSuggestion {
  id: string;
  title: string;
  subtitle: string;
  priority: number;
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
  onSearchSubmit,
}: ToolbarProps) => {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
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

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || normalizedQuery.length < 2) {
      setSuggestions([]);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const loadSuggestions = async () => {
        const [locals, remote] = await Promise.allSettled([
          fetchInstances(),
          fetchUnifiedCatalog({
            category: "Modpacks",
            query: normalizedQuery,
            sort: "relevance",
            platform: "all",
            page: 0,
            pageSize: 5,
          }),
        ]);

        const next: SearchSuggestion[] = [];
        if (locals.status === "fulfilled") {
          locals.value
            .filter((instance) => instance.name.toLowerCase().includes(normalizedQuery.toLowerCase()))
            .slice(0, 4)
            .forEach((instance, index) => {
              next.push({
                id: `local-${instance.id}`,
                title: instance.name,
                subtitle: `Instancia local · ${instance.loaderName} ${instance.version}`,
                priority: 100 - index,
              });
            });
        }
        if (remote.status === "fulfilled") {
          remote.value.items.slice(0, 5).forEach((item, index) => {
            next.push({
              id: `remote-${item.id}`,
              title: item.name,
              subtitle: `${item.type} · ${item.source}`,
              priority: 50 - index,
            });
          });
        }

        setSuggestions(next.sort((a, b) => b.priority - a.priority));
      };
      void loadSuggestions();
    }, 200);

    return () => window.clearTimeout(timeoutId);
  }, [query]);

  const showSuggestions = useMemo(() => showGlobalSearch && query.trim().length >= 2, [query, showGlobalSearch]);

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
            <div className="topbar__search-wrap">
              <label className="topbar__search">
                <span>🔍</span>
                <input
                  type="search"
                  placeholder="Buscar modpacks, mods e instancias..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && query.trim()) {
                      onSearchSubmit(query.trim());
                    }
                  }}
                />
                <button type="button" aria-label="Limpiar búsqueda" onClick={() => setQuery("")}>
                  ✕
                </button>
              </label>
              {showSuggestions ? (
                <div className="topbar__search-suggestions">
                  {suggestions.length ? suggestions.map((suggestion) => (
                    <button key={suggestion.id} type="button" onClick={() => { setQuery(suggestion.title); onSearchSubmit(suggestion.title); }}>
                      <strong>{suggestion.title}</strong>
                      <small>{suggestion.subtitle}</small>
                    </button>
                  )) : <p>Sin sugerencias. Presiona Enter para buscar en todo el catálogo.</p>}
                </div>
              ) : null}
            </div>
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
