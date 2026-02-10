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

export const SettingsPanel = () => {
  const { baseDir, status } = useBaseDir();
  const { t } = useI18n();
  const { theme, setTheme, uiScale, setScale } = useUI();
  const [telemetryOptIn, setTelemetryOptIn] = useState(false);
  const [autoUpdates, setAutoUpdates] = useState(true);
  const [backgroundDownloads, setBackgroundDownloads] = useState(true);
  const [curseforgeKey, setCurseforgeKey] = useState("");

  useEffect(() => {
    const load = async () => {
      const config = await loadConfig();
      setTelemetryOptIn(Boolean(config.telemetryOptIn));
      setCurseforgeKey(getCurseforgeApiKey());
    };
    void load();
  }, []);

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
                  setTheme(event.target.value as typeof theme)
                }
              >
                <option value="system">Sistema</option>
                <option value="light">Claro</option>
                <option value="dark">Oscuro</option>
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
