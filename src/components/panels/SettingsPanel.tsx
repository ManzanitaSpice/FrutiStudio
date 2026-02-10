import { type MouseEvent as ReactMouseEvent, useEffect, useState } from "react";

import { useUI } from "../../hooks/useUI";
import { useBaseDir } from "../../hooks/useBaseDir";
import { useI18n } from "../../i18n/useI18n";
import { loadConfig, saveConfig } from "../../services/configService";
import {
  getCurseforgeApiKey,
  saveCurseforgeApiKey,
} from "../../services/curseforgeKeyService";
import { SelectFolderButton } from "../SelectFolderButton";

const customDefaults = {
  bg: "#f7f4ff",
  surface: "#ffffff",
  surfaceStrong: "#ece7f8",
  border: "#cfc3e8",
  text: "#2f2340",
  muted: "#66597f",
  accent: "#a070ff",
};

export const SettingsPanel = () => {
  const { baseDir, status } = useBaseDir();
  const { t } = useI18n();
  const { theme, setTheme, uiScale, setScale } = useUI();
  const [telemetryOptIn, setTelemetryOptIn] = useState(false);
  const [autoUpdates, setAutoUpdates] = useState(true);
  const [backgroundDownloads, setBackgroundDownloads] = useState(true);
  const [curseforgeKey, setCurseforgeKey] = useState("");
  const [customTheme, setCustomTheme] = useState(customDefaults);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; card: string } | null>(null);

  useEffect(() => {
    const run = async () => {
      const config = await loadConfig();
      setTelemetryOptIn(Boolean(config.telemetryOptIn));
      setAutoUpdates(config.autoUpdates ?? true);
      setBackgroundDownloads(config.backgroundDownloads ?? true);
      setCurseforgeKey(getCurseforgeApiKey());
      if (config.customTheme) {
        setCustomTheme(config.customTheme);
      }
    };
    void run();
  }, []);

  useEffect(() => {
    Object.entries(customTheme).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--custom-${key}`, value);
    });
  }, [customTheme]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  const toggleTelemetry = async () => {
    const config = await loadConfig();
    const nextValue = !telemetryOptIn;
    setTelemetryOptIn(nextValue);
    await saveConfig({ ...config, telemetryOptIn: nextValue });
  };

  const toggleAutoUpdates = async () => {
    const config = await loadConfig();
    const nextValue = !autoUpdates;
    setAutoUpdates(nextValue);
    await saveConfig({ ...config, autoUpdates: nextValue });
  };

  const toggleBackgroundDownloads = async () => {
    const config = await loadConfig();
    const nextValue = !backgroundDownloads;
    setBackgroundDownloads(nextValue);
    await saveConfig({ ...config, backgroundDownloads: nextValue });
  };

  const handleScaleChange = async (nextScale: number) => {
    setScale(nextScale);
    const config = await loadConfig();
    await saveConfig({ ...config, uiScale: nextScale });
  };

  const handleThemeChange = async (nextTheme: typeof theme) => {
    setTheme(nextTheme);
    const config = await loadConfig();
    await saveConfig({ ...config, theme: nextTheme, customTheme });
  };

  const handleCustomColorChange = async (
    key: keyof typeof customDefaults,
    value: string,
  ) => {
    const nextTheme = { ...customTheme, [key]: value };
    setCustomTheme(nextTheme);
    const config = await loadConfig();
    await saveConfig({ ...config, customTheme: nextTheme, theme: "custom" });
    setTheme("custom");
  };

  const handleCardContextMenu = (event: ReactMouseEvent<HTMLElement>, card: string) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, card });
  };

  return (
    <section className="panel-view panel-view--settings">
      <div className="panel-view__header">
        <div>
          <h2>Configuración</h2>
          <p>Ajustes globales del launcher organizados por categorías.</p>
        </div>
      </div>

      <div className="panel-view__body settings-layout">
        <section className="settings-section">
          <header className="settings-section__header">
            <h3>General</h3>
            <p>Ruta base, cuentas y privacidad.</p>
          </header>
          <div className="settings-grid settings-grid--organized">
            <article className="settings-card settings-card--glow" onContextMenu={(event) => handleCardContextMenu(event, "base")}>
              <div className="settings-card__header">
                <h3>{t("baseDir").title}</h3>
                <p>{t("baseDir").placeholder}</p>
              </div>
              <SelectFolderButton />
              <p className="panel-view__status">
                {status === "valid" && baseDir ? t("baseDir").statusValid : null}
                {status === "validating" ? t("baseDir").statusLoading : null}
                {status === "invalid" ? t("baseDir").statusInvalid : null}
                {status === "idle" ? t("baseDir").statusIdle : null}
              </p>
            </article>
            <article className="settings-card settings-card--glow" onContextMenu={(event) => handleCardContextMenu(event, "privacy")}>
              <div className="settings-card__header">
                <h3>Privacidad</h3>
                <p>Controla telemetría y permisos de datos.</p>
              </div>
              <label className="panel-view__toggle">
                <input type="checkbox" checked={telemetryOptIn} onChange={toggleTelemetry} />
                Activar telemetría opcional
              </label>
            </article>
          </div>
        </section>

        <section className="settings-section">
          <header className="settings-section__header">
            <h3>Apariencia y rendimiento</h3>
            <p>Temas, zoom y opciones globales.</p>
          </header>
          <div className="settings-grid settings-grid--organized">
            <article className="settings-card settings-card--glow" onContextMenu={(event) => handleCardContextMenu(event, "apariencia")}>
              <div className="settings-card__header">
                <h3>Apariencia</h3>
                <p>Define tema y escala visual.</p>
              </div>
              <label className="settings-card__field">
                <span>Preferencia de tema</span>
                <select value={theme} onChange={(event) => void handleThemeChange(event.target.value as typeof theme)}>
                  <option value="default">Default</option>
                  <option value="light">Claro</option>
                  <option value="dark">Oscuro</option>
                  <option value="chrome">Chrome</option>
                  <option value="sunset">Sunset</option>
                  <option value="mint">Mint</option>
                  <option value="lavender">Lavender</option>
                  <option value="peach">Peach</option>
                  <option value="custom">Personalizado</option>
                </select>
              </label>
              <label className="settings-card__range">
                <span>Escala UI</span>
                <input type="range" min={0.8} max={1.35} step={0.05} value={uiScale} onChange={(event) => void handleScaleChange(Number(event.target.value))} />
                <strong>{Math.round(uiScale * 100)}%</strong>
              </label>
              {theme === "custom" ? (
                <div className="settings-card__colors">
                  {Object.entries({ Fondo: "bg", Superficie: "surface", Borde: "border", Texto: "text", Acento: "accent" }).map(([label, key]) => (
                    <label key={key}>
                      {label}
                      <input type="color" value={customTheme[key as keyof typeof customDefaults]} onChange={(event) => void handleCustomColorChange(key as keyof typeof customDefaults, event.target.value)} />
                    </label>
                  ))}
                </div>
              ) : null}
            </article>
            <article className="settings-card settings-card--glow" onContextMenu={(event) => handleCardContextMenu(event, "java")}>
              <div className="settings-card__header">
                <h3>Java y memoria</h3>
                <p>Configura rendimiento global.</p>
              </div>
              <div className="settings-card__actions">
                <button type="button">Detectar versiones de Java</button>
                <button type="button">Asignar memoria</button>
                <button type="button">Parámetros de JVM</button>
              </div>
            </article>
          </div>
        </section>

        <section className="settings-section">
          <header className="settings-section__header">
            <h3>Red y actualizaciones</h3>
          </header>
          <div className="settings-grid settings-grid--organized">
            <article className="settings-card settings-card--glow" onContextMenu={(event) => handleCardContextMenu(event, "red")}>
              <div className="settings-card__header">
                <h3>Red y descargas</h3>
              </div>
              <label className="settings-card__field">
                <span>API key de CurseForge</span>
                <input type="password" placeholder="Pega tu key para conectar CurseForge" value={curseforgeKey} onChange={(event) => { setCurseforgeKey(event.target.value); saveCurseforgeApiKey(event.target.value); }} />
              </label>
              <label className="panel-view__toggle">
                <input type="checkbox" checked={backgroundDownloads} onChange={() => void toggleBackgroundDownloads()} />
                Mantener descargas en segundo plano
              </label>
            </article>
            <article className="settings-card settings-card--glow" onContextMenu={(event) => handleCardContextMenu(event, "updates")}>
              <div className="settings-card__header">
                <h3>Actualizaciones</h3>
              </div>
              <label className="panel-view__toggle">
                <input type="checkbox" checked={autoUpdates} onChange={() => void toggleAutoUpdates()} />
                Actualizar launcher automáticamente
              </label>
            </article>
          </div>
        </section>
      </div>

      {contextMenu ? (
        <div className="section-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <span className="section-context-menu__title">Atajos de {contextMenu.card}</span>
          <button type="button" onClick={() => window.alert("Atajo guardado en barra lateral")}>Anclar acceso</button>
          <button type="button" onClick={() => window.alert("Abrir en ventana flotante")}>Abrir rápido</button>
          <button type="button" onClick={() => navigator.clipboard.writeText(`fruti://settings/${contextMenu.card}`)}>Copiar deep-link</button>
        </div>
      ) : null}
    </section>
  );
};
