import { useEffect, useState } from "react";

import { useUI } from "../../hooks/useUI";
import { useBaseDir } from "../../hooks/useBaseDir";
import { useI18n } from "../../i18n/useI18n";
import { loadConfig, saveConfig } from "../../services/configService";
import {
  clearDiscordActivity,
  initDiscordPresence,
  setDiscordActivity,
} from "../../services/discordPresenceService";
import {
  getCurseforgeApiKey,
  saveCurseforgeApiKey,
} from "../../services/curseforgeKeyService";
import { SelectFolderButton } from "../SelectFolderButton";

export const SettingsPanel = () => {
  const { baseDir, status } = useBaseDir();
  const { t } = useI18n();
  const { theme, setTheme, uiScale, setScale, customTheme, setCustomTheme } =
    useUI();
  const [telemetryOptIn, setTelemetryOptIn] = useState(false);
  const [autoUpdates, setAutoUpdates] = useState(true);
  const [backgroundDownloads, setBackgroundDownloads] = useState(true);
  const [curseforgeKey, setCurseforgeKey] = useState("");
  const [discordClientId, setDiscordClientId] = useState("");
  const [discordPresenceEnabled, setDiscordPresenceEnabled] = useState(true);

  useEffect(() => {
    const load = async () => {
      const config = await loadConfig();
      setTelemetryOptIn(Boolean(config.telemetryOptIn));
      if (config.customTheme) {
        setCustomTheme(config.customTheme);
      }
      if (config.discordClientId) {
        setDiscordClientId(config.discordClientId);
      }
      if (typeof config.discordPresenceEnabled === "boolean") {
        setDiscordPresenceEnabled(config.discordPresenceEnabled);
      }
      setCurseforgeKey(getCurseforgeApiKey());
    };
    void load();
  }, [setCustomTheme]);

  const toggleTelemetry = async () => {
    const config = await loadConfig();
    const nextValue = !telemetryOptIn;
    setTelemetryOptIn(nextValue);
    await saveConfig({ ...config, telemetryOptIn: nextValue });
  };

  const handleScaleChange = async (nextScale: number) => {
    setScale(nextScale);
    const config = await loadConfig();
    await saveConfig({ ...config, uiScale: nextScale });
  };

  const handleCurseforgeKeyChange = (value: string) => {
    setCurseforgeKey(value);
    saveCurseforgeApiKey(value);
  };

  const handleThemeChange = async (value: typeof theme) => {
    setTheme(value);
    const config = await loadConfig();
    await saveConfig({ ...config, theme: value, customTheme });
  };

  const handleCustomThemeChange = async (nextTheme: typeof customTheme) => {
    setCustomTheme(nextTheme);
    const config = await loadConfig();
    await saveConfig({ ...config, customTheme: nextTheme });
  };

  const handleDiscordClientIdChange = async (value: string) => {
    setDiscordClientId(value);
    const config = await loadConfig();
    await saveConfig({ ...config, discordClientId: value });
    if (value && discordPresenceEnabled) {
      await initDiscordPresence(value);
      await setDiscordActivity({
        details: "Launcher abierto",
        state: "Configurando FrutiStudio",
      });
    }
  };

  const toggleDiscordPresence = async () => {
    const nextValue = !discordPresenceEnabled;
    setDiscordPresenceEnabled(nextValue);
    const config = await loadConfig();
    await saveConfig({ ...config, discordPresenceEnabled: nextValue });
    if (nextValue && discordClientId) {
      await initDiscordPresence(discordClientId);
      await setDiscordActivity({
        details: "Launcher abierto",
        state: "Configurando FrutiStudio",
      });
    } else {
      await clearDiscordActivity();
    }
  };

  return (
    <section className="panel-view panel-view--settings">
      <div className="panel-view__header">
        <div>
          <h2>Configuración del launcher</h2>
          <p>Personaliza el entorno, las cuentas y el rendimiento general.</p>
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
                <option value="chrome">Chrome</option>
                <option value="aurora">Colores combinados</option>
                <option value="mint">Pastel menta</option>
                <option value="lilac">Pastel lila</option>
                <option value="peach">Pastel durazno</option>
                <option value="sky">Pastel cielo</option>
                <option value="rose">Pastel rosa</option>
                <option value="light">Claro</option>
                <option value="system">Sistema</option>
                <option value="custom">Personalizado</option>
              </select>
            </label>
            {theme === "custom" && (
              <div className="settings-card__palette">
                <label className="settings-card__field settings-card__field--inline">
                  <span>Fondo</span>
                  <input
                    type="color"
                    value={customTheme.background}
                    onChange={(event) =>
                      void handleCustomThemeChange({
                        ...customTheme,
                        background: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="settings-card__field settings-card__field--inline">
                  <span>Tarjetas</span>
                  <input
                    type="color"
                    value={customTheme.card}
                    onChange={(event) =>
                      void handleCustomThemeChange({
                        ...customTheme,
                        card: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="settings-card__field settings-card__field--inline">
                  <span>Superficie</span>
                  <input
                    type="color"
                    value={customTheme.surface}
                    onChange={(event) =>
                      void handleCustomThemeChange({
                        ...customTheme,
                        surface: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="settings-card__field settings-card__field--inline">
                  <span>Texto</span>
                  <input
                    type="color"
                    value={customTheme.text}
                    onChange={(event) =>
                      void handleCustomThemeChange({
                        ...customTheme,
                        text: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="settings-card__field settings-card__field--inline">
                  <span>Acento</span>
                  <input
                    type="color"
                    value={customTheme.accent}
                    onChange={(event) =>
                      void handleCustomThemeChange({
                        ...customTheme,
                        accent: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="settings-card__field settings-card__field--inline">
                  <span>Borde</span>
                  <input
                    type="color"
                    value={customTheme.border}
                    onChange={(event) =>
                      void handleCustomThemeChange({
                        ...customTheme,
                        border: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="settings-card__field settings-card__field--inline">
                  <span>Texto secundario</span>
                  <input
                    type="color"
                    value={customTheme.muted}
                    onChange={(event) =>
                      void handleCustomThemeChange({
                        ...customTheme,
                        muted: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
            )}
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
                onChange={() => setBackgroundDownloads((value) => !value)}
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
                onChange={() => setAutoUpdates((value) => !value)}
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
              <h3>Integraciones</h3>
              <p>Controla presencia en Discord y otros servicios conectados.</p>
            </div>
            <label className="settings-card__field">
              <span>Client ID de Discord</span>
              <input
                type="text"
                placeholder="Pega el Client ID de tu app de Discord"
                value={discordClientId}
                onChange={(event) =>
                  void handleDiscordClientIdChange(event.target.value)
                }
              />
            </label>
            <label className="panel-view__toggle">
              <input
                type="checkbox"
                checked={discordPresenceEnabled}
                onChange={toggleDiscordPresence}
              />
              Activar Rich Presence en Discord
            </label>
            <label className="panel-view__toggle">
              <input
                type="checkbox"
                checked={telemetryOptIn}
                onChange={toggleTelemetry}
              />
              Activar telemetría opcional
            </label>
          </article>
        </div>
      </div>
    </section>
  );
};
