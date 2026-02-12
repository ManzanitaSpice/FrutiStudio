import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";

import { useUI } from "../../hooks/useUI";
import { useBaseDir } from "../../hooks/useBaseDir";
import { useI18n } from "../../i18n/useI18n";
import { loadConfig, saveConfig, type AppConfig } from "../../services/configService";
import { detectJavaProfiles } from "../../services/javaConfig";
import type { JavaProfile } from "../../types/models";
import { SelectFolderButton } from "../SelectFolderButton";
import { launcherFactoryReset } from "../../services/launcherService";
import { checkPterodactylStatus, type PterodactylStatus } from "../../services/pterodactylService";

const customDefaults = {
  bg: "#f7f4ff",
  surface: "#ffffff",
  surfaceStrong: "#ece7f8",
  border: "#cfc3e8",
  text: "#2f2340",
  muted: "#66597f",
  accent: "#a070ff",
};

const updateConfig = async (patch: Partial<AppConfig>) => {
  const config = await loadConfig();
  await saveConfig({ ...config, ...patch });
};

export const SettingsPanel = () => {
  const { baseDir, status } = useBaseDir();
  const { t } = useI18n();
  const { theme, setTheme, uiScale, setScale } = useUI();
  const [telemetryOptIn, setTelemetryOptIn] = useState(false);
  const [backgroundDownloads, setBackgroundDownloads] = useState(true);
  const [customTheme, setCustomTheme] = useState(customDefaults);
  const [neverRenameFolder, setNeverRenameFolder] = useState(false);
  const [replaceToolbarByMenu, setReplaceToolbarByMenu] = useState(false);
  const [modsTrackMetadata, setModsTrackMetadata] = useState(true);
  const [modsInstallDependencies, setModsInstallDependencies] = useState(true);
  const [modsSuggestPackUpdates, setModsSuggestPackUpdates] = useState(true);
  const [modsCheckBlockedSubfolders, setModsCheckBlockedSubfolders] = useState(false);
  const [modsMoveBlockedMods, setModsMoveBlockedMods] = useState(false);
  const [downloadsPath, setDownloadsPath] = useState("");
  const [modsPath, setModsPath] = useState("mods");
  const [iconsPath, setIconsPath] = useState("icons");
  const [javaPath, setJavaPath] = useState("java");
  const [javaMode, setJavaMode] = useState<"auto" | "embedded" | "manual">("embedded");
  const [minecraftRoot, setMinecraftRoot] = useState("");
  const [skinsPath, setSkinsPath] = useState("skins");
  const [fontFamily, setFontFamily] = useState<
    "inter" | "system" | "poppins" | "jetbrains" | "fira"
  >("inter");
  const [detectedJavaProfiles, setDetectedJavaProfiles] = useState<JavaProfile[]>([]);
  const [isDetectingJava, setIsDetectingJava] = useState(false);
  const [factoryResetPhrase, setFactoryResetPhrase] = useState("");
  const [isFactoryResetting, setIsFactoryResetting] = useState(false);
  const [pterodactylUrl, setPterodactylUrl] = useState("");
  const [pterodactylApiKey, setPterodactylApiKey] = useState("");
  const [pterodactylStatus, setPterodactylStatus] = useState<PterodactylStatus | null>(null);
  const [isCheckingPterodactyl, setIsCheckingPterodactyl] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    card: string;
  } | null>(null);

  useEffect(() => {
    const run = async () => {
      const config = await loadConfig();
      setTelemetryOptIn(Boolean(config.telemetryOptIn));
      setBackgroundDownloads(config.backgroundDownloads ?? true);
      setNeverRenameFolder(config.neverRenameFolder ?? false);
      setReplaceToolbarByMenu(config.replaceToolbarByMenu ?? false);
      setModsTrackMetadata(config.modsTrackMetadata ?? true);
      setModsInstallDependencies(config.modsInstallDependencies ?? true);
      setModsSuggestPackUpdates(config.modsSuggestPackUpdates ?? true);
      setModsCheckBlockedSubfolders(config.modsCheckBlockedSubfolders ?? false);
      setModsMoveBlockedMods(config.modsMoveBlockedMods ?? false);
      setDownloadsPath(config.downloadsPath ?? "");
      setModsPath(config.modsPath ?? "mods");
      setIconsPath(config.iconsPath ?? "icons");
      setJavaPath(config.javaPath ?? "java");
      setJavaMode(config.javaMode ?? "embedded");
      setMinecraftRoot(config.minecraftRoot ?? "");
      setSkinsPath(config.skinsPath ?? "skins");
      setFontFamily(config.fontFamily ?? "inter");
      setPterodactylUrl(config.pterodactylUrl ?? "");
      setPterodactylApiKey(config.pterodactylApiKey ?? "");
      if (config.customTheme) {
        setCustomTheme(config.customTheme);
      }
      const javaProfiles = await detectJavaProfiles();
      setDetectedJavaProfiles(javaProfiles);
    };
    void run();
  }, []);

  useEffect(() => {
    Object.entries(customTheme).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--custom-${key}`, value);
    });
  }, [customTheme]);

  useEffect(() => {
    const fontMap = {
      inter: "Inter, system-ui, sans-serif",
      system: "system-ui, -apple-system, Segoe UI, sans-serif",
      poppins: "Poppins, Inter, system-ui, sans-serif",
      jetbrains: "JetBrains Mono, Fira Code, monospace",
      fira: "Fira Sans, Inter, system-ui, sans-serif",
    } as const;
    document.documentElement.style.setProperty("--app-font-family", fontMap[fontFamily]);
  }, [fontFamily]);

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

  const javaSummary = useMemo(() => {
    if (!detectedJavaProfiles.length) {
      return "No se detectaron instalaciones de Java todavía.";
    }
    const recommended = detectedJavaProfiles.find((runtime) => runtime.recommended);
    if (recommended) {
      return `Se detectaron ${detectedJavaProfiles.length} instalaciones. Recomendado: ${recommended.name}.`;
    }
    return `Se detectaron ${detectedJavaProfiles.length} instalaciones de Java en el sistema.`;
  }, [detectedJavaProfiles]);

  const handleDetectJava = async () => {
    setIsDetectingJava(true);
    try {
      const javaProfiles = await detectJavaProfiles();
      setDetectedJavaProfiles(javaProfiles);
      if (javaProfiles[0]?.path) {
        setJavaPath(javaProfiles[0].path);
        await updateConfig({ javaPath: javaProfiles[0].path });
      }
    } finally {
      setIsDetectingJava(false);
    }
  };

  const handleCheckPterodactyl = async () => {
    setIsCheckingPterodactyl(true);
    try {
      const status = await checkPterodactylStatus(pterodactylUrl, pterodactylApiKey);
      setPterodactylStatus(status);
    } catch (error) {
      setPterodactylStatus({
        ok: false,
        panelUrl: pterodactylUrl,
        message:
          error instanceof Error
            ? `No se pudo validar Pterodactyl: ${error.message}`
            : "No se pudo validar Pterodactyl.",
      });
    } finally {
      setIsCheckingPterodactyl(false);
    }
  };

  const handleFactoryReset = async () => {
    if (factoryResetPhrase.trim().toUpperCase() !== "REINSTALAR") {
      window.alert("Escribe REINSTALAR para confirmar la reinstalación completa.");
      return;
    }

    const accepted = window.confirm(
      "Esta acción reinstalará Fruti Launcher desde cero y limpiará runtime, versiones, librerías, assets, cachés y base de datos local sin tocar instancias externas. ¿Deseas continuar?",
    );
    if (!accepted) {
      return;
    }

    setIsFactoryResetting(true);
    try {
      const result = await launcherFactoryReset(factoryResetPhrase);
      const removed = [...result.clearedRoots, ...result.removedEntries].length;
      window.alert(
        `Reinstalación completada. Se limpiaron ${removed} rutas. El launcher se recargará para iniciar desde cero.`,
      );
      window.location.reload();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo completar la reinstalación.";
      window.alert(message);
    } finally {
      setIsFactoryResetting(false);
    }
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
        </div>
      </div>

      <div className="panel-view__body settings-layout">
        <section className="settings-section">
          <header className="settings-section__header">
            <h3>General</h3>
            <p>Ruta base, cuentas, carpetas y privacidad.</p>
          </header>
          <div className="settings-grid settings-grid--organized">
            <article
              className="settings-card settings-card--glow"
              onContextMenu={(event) => handleCardContextMenu(event, "base")}
            >
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
              <label className="panel-view__toggle">
                <input
                  type="checkbox"
                  checked={neverRenameFolder}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setNeverRenameFolder(next);
                    void updateConfig({ neverRenameFolder: next });
                  }}
                />
                Nunca renombrar carpetas de instancia
              </label>
              <label className="panel-view__toggle">
                <input
                  type="checkbox"
                  checked={replaceToolbarByMenu}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setReplaceToolbarByMenu(next);
                    void updateConfig({ replaceToolbarByMenu: next });
                  }}
                />
                Reemplazar barra de herramientas por barra de menú
              </label>
            </article>

            <article
              className="settings-card settings-card--glow"
              onContextMenu={(event) => handleCardContextMenu(event, "folders")}
            >
              <div className="settings-card__header">
                <h3>Carpetas</h3>
                <p>Rutas al estilo Prism para instancias y recursos globales.</p>
              </div>
              <label className="settings-card__field">
                <span>Instancias</span>
                <input value={baseDir ?? ""} readOnly />
              </label>
              <label className="settings-card__field">
                <span>Mods</span>
                <input
                  value={modsPath}
                  onChange={(event) => {
                    setModsPath(event.target.value);
                    void updateConfig({ modsPath: event.target.value });
                  }}
                />
              </label>
              <label className="settings-card__field">
                <span>Iconos</span>
                <input
                  value={iconsPath}
                  onChange={(event) => {
                    setIconsPath(event.target.value);
                    void updateConfig({ iconsPath: event.target.value });
                  }}
                />
              </label>
              <label className="settings-card__field">
                <span>Java</span>
                <input
                  value={javaPath}
                  onChange={(event) => {
                    setJavaPath(event.target.value);
                    void updateConfig({ javaPath: event.target.value });
                  }}
                />
              </label>
              <label className="settings-card__field">
                <span>%Skins</span>
                <input
                  value={skinsPath}
                  onChange={(event) => {
                    setSkinsPath(event.target.value);
                    void updateConfig({ skinsPath: event.target.value });
                  }}
                />
              </label>
              <label className="settings-card__field">
                <span>Descargas</span>
                <input
                  value={downloadsPath}
                  placeholder="C:/Users/TuUsuario/Downloads"
                  onChange={(event) => {
                    setDownloadsPath(event.target.value);
                    void updateConfig({ downloadsPath: event.target.value });
                  }}
                />
              </label>
            </article>

            <article
              className="settings-card settings-card--glow"
              onContextMenu={(event) => handleCardContextMenu(event, "privacy")}
            >
              <div className="settings-card__header">
                <h3>Privacidad</h3>
                <p>Controla telemetría y permisos de diagnóstico.</p>
              </div>
              <label className="panel-view__toggle">
                <input
                  type="checkbox"
                  checked={telemetryOptIn}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setTelemetryOptIn(next);
                    void updateConfig({ telemetryOptIn: next });
                  }}
                />
                Telemetría opcional
              </label>
            </article>

            <article
              className="settings-card settings-card--glow"
              onContextMenu={(event) => handleCardContextMenu(event, "reinstall")}
            >
              <div className="settings-card__header">
                <h3>Reinstalación completa (desde 0)</h3>
                <p>
                  Limpia carpeta del launcher, instancias y datos locales para recuperar
                  un estado limpio ante corrupción de archivos o configuraciones dañadas.
                </p>
              </div>
              <label className="settings-card__field">
                <span>Confirmación</span>
                <input
                  value={factoryResetPhrase}
                  placeholder="Escribe REINSTALAR"
                  onChange={(event) => setFactoryResetPhrase(event.target.value)}
                />
              </label>
              <div className="settings-card__actions">
                <button type="button" onClick={() => void handleFactoryReset()}>
                  {isFactoryResetting ? "Reinstalando..." : "Reinstalar launcher desde 0"}
                </button>
              </div>
              <small>
                En Windows se solicitará confirmación de administrador antes del borrado
                total.
              </small>
            </article>
          </div>
        </section>

        <section className="settings-section">
          <header className="settings-section__header">
            <h3>Apariencia, Java y mods</h3>
            <p>Opciones equivalentes a launchers avanzados como Prism.</p>
          </header>
          <div className="settings-grid settings-grid--organized">
            <article
              className="settings-card settings-card--glow"
              onContextMenu={(event) => handleCardContextMenu(event, "apariencia")}
            >
              <div className="settings-card__header">
                <h3>Apariencia</h3>
                <p>Define tema y escala visual.</p>
              </div>
              <label className="settings-card__field">
                <span>Preferencia de tema</span>
                <select
                  value={theme}
                  onChange={(event) => {
                    const nextTheme = event.target.value as typeof theme;
                    setTheme(nextTheme);
                    void updateConfig({ theme: nextTheme, customTheme });
                  }}
                >
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
              <label className="settings-card__field">
                <span>Tipografía</span>
                <select
                  value={fontFamily}
                  onChange={(event) => {
                    const nextFont = event.target.value as typeof fontFamily;
                    setFontFamily(nextFont);
                    void updateConfig({ fontFamily: nextFont });
                  }}
                >
                  <option value="inter">Inter (predeterminada)</option>
                  <option value="system">System UI</option>
                  <option value="poppins">Poppins</option>
                  <option value="fira">Fira Sans</option>
                  <option value="jetbrains">JetBrains Mono</option>
                </select>
              </label>

              <label className="settings-card__range">
                <span>Escala UI</span>
                <input
                  type="range"
                  min={0.8}
                  max={1.35}
                  step={0.05}
                  value={uiScale}
                  onChange={(event) => {
                    const nextScale = Number(event.target.value);
                    setScale(nextScale);
                    void updateConfig({ uiScale: nextScale });
                  }}
                />
                <strong>{Math.round(uiScale * 100)}%</strong>
              </label>
              {theme === "custom" ? (
                <div className="settings-card__colors">
                  {Object.entries({
                    Fondo: "bg",
                    Superficie: "surface",
                    Borde: "border",
                    Texto: "text",
                    Acento: "accent",
                  }).map(([label, key]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="color"
                        value={customTheme[key as keyof typeof customDefaults]}
                        onChange={(event) => {
                          const nextTheme = {
                            ...customTheme,
                            [key as keyof typeof customDefaults]: event.target.value,
                          };
                          setCustomTheme(nextTheme);
                          setTheme("custom");
                          void updateConfig({ customTheme: nextTheme, theme: "custom" });
                        }}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
            </article>

            <article
              className="settings-card settings-card--glow"
              onContextMenu={(event) => handleCardContextMenu(event, "java")}
            >
              <div className="settings-card__header">
                <h3>Java</h3>
                <p>{javaSummary}</p>
              </div>
              <div className="settings-card__actions">
                <button type="button" onClick={() => void handleDetectJava()}>
                  {isDetectingJava ? "Detectando..." : "Detectar instalaciones Java"}
                </button>
              </div>
              <label className="panel-view__field">
                Modo de Java
                <select
                  value={javaMode}
                  onChange={(event) => {
                    const next = event.target.value as "auto" | "embedded" | "manual";
                    setJavaMode(next);
                    void updateConfig({ javaMode: next });
                  }}
                >
                  <option value="auto">Auto (detectar/selección automática)</option>
                  <option value="embedded">Embebido del launcher</option>
                  <option value="manual">Manual</option>
                </select>
              </label>
              <label className="panel-view__field">
                Java manual
                <input
                  type="text"
                  value={javaPath}
                  placeholder="Ruta a java/javaw"
                  disabled={javaMode !== "manual"}
                  onChange={(event) => {
                    const next = event.target.value;
                    setJavaPath(next);
                    void updateConfig({ javaPath: next });
                  }}
                />
              </label>
              <label className="panel-view__field">
                Launcher principal (oficial)
                <input
                  type="text"
                  value={minecraftRoot}
                  placeholder="Ej. C:\Users\Arthur\AppData\Roaming\.minecraft"
                  onChange={(event) => {
                    const next = event.target.value;
                    setMinecraftRoot(next);
                    void updateConfig({ minecraftRoot: next });
                  }}
                />
              </label>
              <ul className="settings-card__java-list">
                {detectedJavaProfiles.map((runtime) => (
                  <li key={`${runtime.path}-${runtime.version}`}>
                    <strong>{runtime.name}</strong>
                    <span>{runtime.path}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article
              className="settings-card settings-card--glow"
              onContextMenu={(event) => handleCardContextMenu(event, "mods")}
            >
              <div className="settings-card__header">
                <h3>Mods y modpacks</h3>
                <p>Opciones de compatibilidad inspiradas en Prism Launcher.</p>
              </div>
              <label className="panel-view__toggle">
                <input
                  type="checkbox"
                  checked={modsCheckBlockedSubfolders}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setModsCheckBlockedSubfolders(next);
                    void updateConfig({ modsCheckBlockedSubfolders: next });
                  }}
                />
                Revisar subcarpetas por mods bloqueados
              </label>
              <label className="panel-view__toggle">
                <input
                  type="checkbox"
                  checked={modsMoveBlockedMods}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setModsMoveBlockedMods(next);
                    void updateConfig({ modsMoveBlockedMods: next });
                  }}
                />
                Mover mods bloqueados en vez de copiarlos
              </label>
              <label className="panel-view__toggle">
                <input
                  type="checkbox"
                  checked={modsTrackMetadata}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setModsTrackMetadata(next);
                    void updateConfig({ modsTrackMetadata: next });
                  }}
                />
                Mantener metadata de mods
              </label>
              <label className="panel-view__toggle">
                <input
                  type="checkbox"
                  checked={modsInstallDependencies}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setModsInstallDependencies(next);
                    void updateConfig({ modsInstallDependencies: next });
                  }}
                />
                Instalar dependencias automáticamente
              </label>
              <label className="panel-view__toggle">
                <input
                  type="checkbox"
                  checked={modsSuggestPackUpdates}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setModsSuggestPackUpdates(next);
                    void updateConfig({ modsSuggestPackUpdates: next });
                  }}
                />
                Sugerir actualización de instancia en instalación de modpacks
              </label>
            </article>

            <article
              className="settings-card settings-card--glow"
              onContextMenu={(event) => handleCardContextMenu(event, "pterodactyl")}
            >
              <div className="settings-card__header">
                <h3>Pterodactyl</h3>
                <p>Panel de inicialización remoto para instancias dedicadas.</p>
              </div>
              <label className="panel-view__field">
                URL del panel
                <input
                  type="text"
                  value={pterodactylUrl}
                  placeholder="https://panel.tu-host.com"
                  onChange={(event) => {
                    const next = event.target.value;
                    setPterodactylUrl(next);
                    void updateConfig({ pterodactylUrl: next });
                  }}
                />
              </label>
              <label className="panel-view__field">
                API key (cliente)
                <input
                  type="password"
                  value={pterodactylApiKey}
                  placeholder="ptlc_..."
                  onChange={(event) => {
                    const next = event.target.value;
                    setPterodactylApiKey(next);
                    void updateConfig({ pterodactylApiKey: next });
                  }}
                />
              </label>
              <div className="settings-card__actions">
                <button type="button" onClick={() => void handleCheckPterodactyl()}>
                  {isCheckingPterodactyl ? "Conectando..." : "Probar conexión"}
                </button>
              </div>
              {pterodactylStatus ? (
                <p className="settings-card__hint">
                  {pterodactylStatus.message}
                  {pterodactylStatus.username
                    ? ` Usuario: ${pterodactylStatus.username}`
                    : ""}
                </p>
              ) : null}
            </article>
          </div>
        </section>

        <section className="settings-section">
          <header className="settings-section__header">
            <h3>Red y actualizaciones</h3>
          </header>
          <div className="settings-grid settings-grid--organized">
            <article
              className="settings-card settings-card--glow"
              onContextMenu={(event) => handleCardContextMenu(event, "red")}
            >
              <div className="settings-card__header">
                <h3>Red y descargas</h3>
              </div>
              <p className="panel-view__status">
                La integración de CurseForge usa una API key privada en backend (Tauri)
                para que no se exponga en la interfaz.
              </p>
              <label className="panel-view__toggle">
                <input
                  type="checkbox"
                  checked={backgroundDownloads}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setBackgroundDownloads(next);
                    void updateConfig({ backgroundDownloads: next });
                  }}
                />
                Mantener descargas en segundo plano
              </label>
            </article>
          </div>
        </section>
      </div>

      {contextMenu ? (
        <div
          className="section-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <span className="section-context-menu__title">
            Atajos de {contextMenu.card}
          </span>
          <button
            type="button"
            onClick={() => window.alert("Atajo guardado en barra lateral")}
          >
            Anclar acceso
          </button>
          <button type="button" onClick={() => window.alert("Abrir en ventana flotante")}>
            Abrir rápido
          </button>
          <button
            type="button"
            onClick={() =>
              navigator.clipboard.writeText(`fruti://settings/${contextMenu.card}`)
            }
          >
            Copiar deep-link
          </button>
        </div>
      ) : null}
    </section>
  );
};
