import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { BaseDirProvider } from "./context/BaseDirContext";
import { UIProvider } from "./context/UIContext";
import { InstanceProvider } from "./context/instanceContext";
import { NotificationProvider } from "./context/NotificationContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NotificationCenter } from "./components/NotificationCenter";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useUiZoom } from "./hooks/useUiZoom";
import { useUI } from "./hooks/useUI";
import { featureFlags } from "./config/featureFlags";
import { fetchInstances } from "./services/instanceService";
import { fetchNewsOverview } from "./services/newsService";
import { fetchExplorerItems } from "./services/explorerService";
import { fetchServerListings } from "./services/serverService";
import { loadConfig, saveConfig } from "./services/configService";
import { collectStartupFiles } from "./services/startupService";
import type { Instance } from "./types/models";
import "./App.css";

const InstancePanel = lazy(() =>
  import("./components/panels/InstancePanel").then((module) => ({
    default: module.InstancePanel,
  })),
);
const ExplorerPanel = lazy(() =>
  import("./components/panels/ExplorerPanel").then((module) => ({
    default: module.ExplorerPanel,
  })),
);
const NewsPanel = lazy(() =>
  import("./components/panels/NewsPanel").then((module) => ({
    default: module.NewsPanel,
  })),
);
const ServersPanel = lazy(() =>
  import("./components/panels/ServersPanel").then((module) => ({
    default: module.ServersPanel,
  })),
);
const SettingsPanel = lazy(() =>
  import("./components/panels/SettingsPanel").then((module) => ({
    default: module.SettingsPanel,
  })),
);

const loadingSteps = [
  "Inicializando launcher",
  "Leyendo archivos locales",
  "Cargando catálogos de contenido",
  "Aplicando configuración de usuario",
  "Sincronizando estado final",
];

const launcherTips = [
  "Tip: Minecraft 1.21 mejora el rendimiento del mundo con optimizaciones en el motor de chunks.",
  "Tip: Puedes combinar Modrinth y CurseForge desde el explorador para encontrar mods más rápido.",
  "Novedad FrutiLauncher: la cola de descargas mantiene progreso en segundo plano.",
  "Tip: Revisa la pestaña de servidores para detectar listados con versión compatible automáticamente.",
  "Minecraft Live: revisa snapshots y pruebas experimentales para bloques y biomas nuevos.",
  "Novedad FrutiLauncher: puedes ajustar la escala UI para pantallas HiDPI en Configuración.",
];

const defaultCustomTheme = {
  bg: "#f7f4ff",
  surface: "#ffffff",
  surfaceStrong: "#ece7f8",
  border: "#cfc3e8",
  text: "#2f2340",
  muted: "#66597f",
  accent: "#a070ff",
};

const AppShell = () => {
  const {
    activeSection,
    uiScale,
    isFocusMode,
    setScale,
    setSection,
    toggleFocus,
    setTheme,
    theme,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
  } = useUI();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [bootReady, setBootReady] = useState(false);
  const [showVerificationWindow, setShowVerificationWindow] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchToken, setGlobalSearchToken] = useState(0);
  const [bootStep, setBootStep] = useState(0);
  const [bootEvents, setBootEvents] = useState<string[]>([]);
  const [activeTip, setActiveTip] = useState(launcherTips[0]);
  const [tipIndex, setTipIndex] = useState(0);
  const bootStartedAt = useRef<number>(Date.now());
  const bootHydrated = useRef(false);

  useEffect(() => {
    const runBoot = async () => {
      let shouldShowVerification = false;
      try {
        bootStartedAt.current = Date.now();
        setBootStep(0);
        const config = await loadConfig();
        shouldShowVerification = Boolean(config.showVerificationWindow);
        setShowVerificationWindow(shouldShowVerification);

        if (shouldShowVerification) {
          const startupFiles = await collectStartupFiles();
          setBootStep(1);
          if (startupFiles.length) {
            setBootEvents(
              startupFiles.map(
                (file) =>
                  `Archivo verificado: ${file.relativePath} · ${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
              ),
            );
          } else {
            setBootEvents([
              "Archivo verificado: no se detectaron archivos locales para inspección.",
            ]);
          }
        }

        setBootStep(2);
        const [instancesResult] = await Promise.allSettled([
          fetchInstances(),
          fetchNewsOverview(),
          fetchExplorerItems("Modpacks"),
          fetchServerListings(),
        ]);
        setBootEvents((prev) => [...prev, "Catálogos remotos sincronizados."]);

        if (config.uiScale) {
          setScale(config.uiScale);
        }
        if (config.theme) {
          setTheme(config.theme);
        }
        if (config.activeSection) {
          setSection(config.activeSection);
        }
        if (typeof config.focusMode === "boolean") {
          if (config.focusMode !== isFocusMode) {
            toggleFocus();
          }
        }
        if (config.customTheme) {
          Object.entries(config.customTheme).forEach(([key, value]) => {
            document.documentElement.style.setProperty(`--custom-${key}`, value);
          });
        } else {
          Object.entries(defaultCustomTheme).forEach(([key, value]) => {
            document.documentElement.style.setProperty(`--custom-${key}`, value);
          });
        }

        setBootStep(3);
        setBootEvents((prev) => [...prev, "Preferencias de usuario aplicadas."]);
        const loadedInstances =
          instancesResult.status === "fulfilled"
            ? instancesResult.value
            : await fetchInstances();
        setInstances(loadedInstances);
        setBootStep(4);
        setBootEvents((prev) => [...prev, "Launcher operativo. ¡Listo para jugar!"]);
      } catch (error) {
        console.error("Error durante el arranque", error);
        setBootEvents((prev) => [
          ...prev,
          "Advertencia: hubo un error al cargar algunos módulos. Continuando...",
        ]);
      } finally {
        const elapsed = Date.now() - bootStartedAt.current;
        const minimumBootDuration = shouldShowVerification ? 3_000 : 0;
        const remaining = Math.max(0, minimumBootDuration - elapsed);
        window.setTimeout(() => setBootReady(true), remaining);
        bootHydrated.current = true;
      }
    };
    void runBoot();
  }, [setScale, setTheme, setSection, isFocusMode, toggleFocus]);

  useEffect(() => {
    if (!showVerificationWindow || bootReady) {
      return;
    }
    const tipTimer = window.setInterval(() => {
      setTipIndex((current) => {
        const next = (current + 1) % launcherTips.length;
        setActiveTip(launcherTips[next]);
        return next;
      });
    }, 3500);
    return () => window.clearInterval(tipTimer);
  }, [showVerificationWindow, bootReady]);

  useUiZoom({
    scale: uiScale,
    onChange: (nextScale) => {
      setScale(nextScale);
      const persist = async () => {
        const config = await loadConfig();
        await saveConfig({ ...config, uiScale: nextScale });
      };
      void persist();
    },
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", uiScale.toString());
  }, [uiScale]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const persist = async () => {
      const config = await loadConfig();
      await saveConfig({ ...config, theme });
    };
    void persist();
  }, [theme]);

  useEffect(() => {
    if (!bootHydrated.current) {
      return;
    }
    const persist = async () => {
      const config = await loadConfig();
      await saveConfig({ ...config, activeSection, focusMode: isFocusMode });
    };
    void persist();
  }, [activeSection, isFocusMode]);

  useKeyboardShortcuts({
    onSelectSection: setSection,
    onToggleFocus: toggleFocus,
  });

  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );

  const handleClearSelection = () => setSelectedInstanceId(null);
  const handleCreateInstance = (instance: Instance) => {
    setInstances((prev) => [instance, ...prev]);
    setSelectedInstanceId(instance.id);
  };

  const handleUpdateInstance = (instanceId: string, patch: Partial<Instance>) => {
    setInstances((prev) =>
      prev.map((instance) =>
        instance.id === instanceId ? { ...instance, ...patch } : instance,
      ),
    );
  };

  const handleDeleteInstance = (instanceId: string) => {
    setInstances((prev) => prev.filter((instance) => instance.id !== instanceId));
    setSelectedInstanceId((prev) => (prev === instanceId ? null : prev));
  };
  const showStatusBar = activeSection === "mis-modpacks" && !isFocusMode;
  const bootProgress = Math.min(
    100,
    Math.round(((bootStep + 1) / loadingSteps.length) * 100),
  );

  const handleGlobalSearch = (query: string) => {
    setGlobalSearchQuery(query);
    setGlobalSearchToken((prev) => prev + 1);
    setSection("explorador");
  };

  const handleCancelBoot = async () => {
    setBootEvents((prev) => [
      ...prev,
      "Proceso de verificación cancelado por el usuario.",
    ]);
    await getCurrentWindow().close();
  };

  return (
    <ErrorBoundary>
      <div className={isFocusMode ? "app-shell app-shell--focus" : "app-shell"}>
        {showVerificationWindow && !bootReady && (
          <div className="boot-screen" role="status" aria-live="polite">
            <div className="boot-screen__window">
              <div className="boot-screen__logo" aria-label="FrutiLauncher cargando">
                <p className="boot-screen__eyebrow">Fruti Studio</p>
                <span>FrutiLauncher</span>
                <p className="boot-screen__subtitle">
                  Verificando entorno y archivos de inicio
                </p>
              </div>
              <div className="boot-screen__progress" aria-hidden="true">
                <div style={{ width: `${bootProgress}%` }} />
              </div>
              <p className="boot-screen__percent">{bootProgress}%</p>
              <ul>
                {loadingSteps.map((step, index) => {
                  const done = index <= bootStep;
                  return (
                    <li key={step} className={done ? "is-done" : ""}>
                      {step}
                    </li>
                  );
                })}
              </ul>
              <div className="boot-screen__events" role="log" aria-live="polite">
                {bootEvents.map((event, index) => (
                  <p
                    key={`${event}-${index}`}
                    style={{ animationDelay: `${index * 0.1}s` }}
                  >
                    {event}
                  </p>
                ))}
              </div>
              <div className="boot-screen__tips">
                <p className="boot-screen__tips-label">Tip rotativo #{tipIndex + 1}</p>
                <p>{activeTip}</p>
              </div>
              <div className="boot-screen__actions">
                <button
                  type="button"
                  className="boot-screen__cancel"
                  onClick={() => void handleCancelBoot()}
                >
                  Cancelar verificación
                </button>
              </div>
            </div>
          </div>
        )}
        <NotificationCenter />
        <Toolbar
          current={activeSection}
          onSelect={setSection}
          showGlobalSearch={activeSection !== "mis-modpacks"}
          flags={featureFlags}
          isFocusMode={isFocusMode}
          onBack={goBack}
          onForward={goForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onSearchSubmit={handleGlobalSearch}
        />
        <div className="app-shell__body app-shell__body--no-sidebar">
          <main className="main-panel" role="main">
            <Suspense fallback={<div className="panel-loading">Cargando…</div>}>
              {activeSection === "mis-modpacks" && (
                <InstancePanel
                  instances={instances}
                  selectedInstanceId={selectedInstanceId}
                  onSelectInstance={setSelectedInstanceId}
                  onClearSelection={handleClearSelection}
                  onCreateInstance={handleCreateInstance}
                  onUpdateInstance={handleUpdateInstance}
                  onDeleteInstance={handleDeleteInstance}
                  isFocusMode={isFocusMode}
                  onToggleFocusMode={toggleFocus}
                />
              )}
              {activeSection === "novedades" && featureFlags.news && <NewsPanel />}
              {activeSection === "explorador" && featureFlags.explorer && (
                <ExplorerPanel
                  externalQuery={globalSearchQuery}
                  externalQueryToken={globalSearchToken}
                />
              )}
              {activeSection === "servers" && featureFlags.servers && <ServersPanel />}
              {activeSection === "configuracion" && featureFlags.settings && (
                <SettingsPanel />
              )}
            </Suspense>
          </main>
        </div>
        {showStatusBar && (
          <StatusBar selectedInstance={selectedInstance} instances={instances} />
        )}
      </div>
    </ErrorBoundary>
  );
};

function App() {
  return (
    <UIProvider>
      <BaseDirProvider>
        <NotificationProvider>
          <InstanceProvider>
            <AppShell />
          </InstanceProvider>
        </NotificationProvider>
      </BaseDirProvider>
    </UIProvider>
  );
}

export default App;
