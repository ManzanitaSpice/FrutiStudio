import { useEffect, useState } from "react";

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

  useEffect(() => {
    const load = async () => {
      const config = await loadConfig();
      setTelemetryOptIn(Boolean(config.telemetryOptIn));
      setAutoUpdates(config.autoUpdates ?? true);
      setBackgroundDownloads(config.backgroundDownloads ?? true);
      setCurseforgeKey(getCurseforgeApiKey());
      if (config.customTheme) {
        setCustomTheme(config.customTheme);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    Object.entries(customTheme).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--custom-${key}`, value);
    });
  }, [customTheme]);

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

  const handleCurseforgeKeyChange = (value: string) => {
    setCurseforgeKey(value);
    saveCurseforgeApiKey(value);
  };

  return (
    <section className="panel-view panel-view--settings">
      <div className="panel-view__header">
        <div>
          <h2>Configuración del launcher</h2>
          <p>Ajusta apariencia, cuenta y rendimiento del launcher.</p>
        </div>
      </div>
      <div className="panel-view__body">
        <div className="settings-grid">
          <article className="settings-card">
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
          <article className="settings-card">
            <div className="settings-card__header">
              <h3>Apariencia y accesibilidad</h3>
              <p>Define tema, zoom y contraste del launcher.</p>
            </div>
            <label className="settings-card__field">
              <span>Preferencia de tema</span>
              <select
                aria-label="Tema del launcher"
                value={theme}
                onChange={(event) =>
                  void handleThemeChange(event.target.value as typeof theme)
                }
              >
                <option value="default">Default</option>
                <option value="light">Claro</option>
                <option value="dark">Oscuro</option>
                <option value="chrome">Chrome</option>
                <option value="sunset">ManzanitaJ</option>
                <option value="mint">Mint</option>
                <option value="lavender">Lavender</option>
                <option value="peach">Peach</option>
                <option value="custom">Personalizado</option>
              </select>
            </label>
            <label className="settings-card__field">
              <span>Zoom de interfaz</span>
              <div className="settings-card__range">
                <input
                  type="range"
                  min={0.8}
                  max={1.5}
                  step={0.05}
                  value={uiScale}
                  onChange={(event) =>
                    void handleScaleChange(Number(event.target.value))
                  }
                />
                <strong>{Math.round(uiScale * 100)}%</strong>
              </div>
            </label>
            {(theme === "custom" || theme === "default") && (
              <div className="settings-card__colors">
                <p>Paleta pastel personalizada</p>
                <label>
                  Fondo
                  <input
                    type="color"
                    value={customTheme.bg}
                    onChange={(event) =>
                      void handleCustomColorChange("bg", event.target.value)
                    }
                  />
                </label>
                <label>
                  Tarjetas
                  <input
                    type="color"
                    value={customTheme.surface}
                    onChange={(event) =>
                      void handleCustomColorChange("surface", event.target.value)
                    }
                  />
                </label>
                <label>
                  Superficie fuerte
                  <input
                    type="color"
                    value={customTheme.surfaceStrong}
                    onChange={(event) =>
                      void handleCustomColorChange(
                        "surfaceStrong",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <label>
                  Bordes
                  <input
                    type="color"
                    value={customTheme.border}
                    onChange={(event) =>
                      void handleCustomColorChange("border", event.target.value)
                    }
                  />
                </label>
                <label>
                  Texto
                  <input
                    type="color"
                    value={customTheme.text}
                    onChange={(event) =>
                      void handleCustomColorChange("text", event.target.value)
                    }
                  />
                </label>
                <label>
                  Texto secundario
                  <input
                    type="color"
                    value={customTheme.muted}
                    onChange={(event) =>
                      void handleCustomColorChange("muted", event.target.value)
                    }
                  />
                </label>
                <label>
                  Color de acento
                  <input
                    type="color"
                    value={customTheme.accent}
                    onChange={(event) =>
                      void handleCustomColorChange("accent", event.target.value)
                    }
                  />
                </label>
              </div>
            )}
          </article>
          <article className="settings-card">
            <div className="settings-card__header">
              <h3>Cuentas y perfiles</h3>
              <p>Administra sesiones, perfiles y atajos rápidos.</p>
            </div>
            <div className="settings-card__actions">
              <button type="button">Administrar cuentas</button>
              <button type="button">Sincronizar perfiles</button>
              <button type="button">Cambiar cuenta principal</button>
            </div>
          </article>
          <article className="settings-card">
            <div className="settings-card__header">
              <h3>Java &amp; memoria</h3>
              <p>Ajusta el rendimiento global para todas las instancias.</p>
            </div>
            <div className="settings-card__actions">
              <button type="button">Detectar versiones de Java</button>
              <button type="button">Asignar memoria</button>
              <button type="button">Parámetros de JVM</button>
            </div>
          </article>
        </div>
        <div className="settings-grid settings-grid--secondary">
          <article className="settings-card">
            <div className="settings-card__header">
              <h3>Red y descargas</h3>
              <p>Controla mirrors, ancho de banda y modo offline.</p>
            </div>
            <label className="settings-card__field">
              <span>API key de CurseForge</span>
              <input
                type="password"
                placeholder="Pega tu key para conectar CurseForge"
                value={curseforgeKey}
                onChange={(event) => handleCurseforgeKeyChange(event.target.value)}
              />
            </label>
            <label className="panel-view__toggle">
              <input
                type="checkbox"
                checked={backgroundDownloads}
                onChange={() => void toggleBackgroundDownloads()}
              />
              Mantener descargas en segundo plano
            </label>
            <div className="settings-card__actions">
              <button type="button">Gestionar mirrors</button>
              <button type="button">Limpiar caché</button>
            </div>
          </article>
          <article className="settings-card">
            <div className="settings-card__header">
              <h3>Actualizaciones y plugins</h3>
              <p>Define cuándo actualizar el launcher y sus extensiones.</p>
            </div>
            <label className="panel-view__toggle">
              <input
                type="checkbox"
                checked={autoUpdates}
                onChange={() => void toggleAutoUpdates()}
              />
              Actualizar launcher automáticamente
            </label>
            <div className="settings-card__actions">
              <button type="button">Revisar plugins</button>
              <button type="button">Ver historial de cambios</button>
            </div>
          </article>
          <article className="settings-card">
            <div className="settings-card__header">
              <h3>Privacidad</h3>
              <p>Decide qué datos comparte el launcher contigo.</p>
            </div>
            <label className="panel-view__toggle">
              <input
                type="checkbox"
                checked={telemetryOptIn}
                onChange={toggleTelemetry}
              />
              Activar telemetría opcional
            </label>
            <div className="settings-card__actions">
              <button type="button">Descargar datos</button>
              <button type="button">Restablecer permisos</button>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
};
