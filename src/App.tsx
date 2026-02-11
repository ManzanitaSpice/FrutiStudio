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
import { fetchInstances, updateInstance as persistInstanceUpdate } from "./services/instanceService";
import { fetchNewsOverview } from "./services/newsService";
import { fetchExplorerItems } from "./services/explorerService";
import { fetchServerListings } from "./services/serverService";
import { loadConfig, saveConfig } from "./services/configService";
import { collectStartupFiles, preloadStartupCatalogs } from "./services/startupService";
import { logMessage } from "./services/logService";
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
const FeaturesPanel = lazy(() =>
  import("./components/panels/NewsPanel").then((module) => ({
    default: module.NewsPanel,
  })),
);
const ServersPanel = lazy(() =>
  import("./components/panels/ServersPanel").then((module) => ({
    default: module.ServersPanel,
  })),
);
const CommunityPanel = lazy(() =>
  import("./components/panels/CommunityPanel").then((module) => ({
    default: module.CommunityPanel,
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
  "Consejo FrutiLauncher: la cola de descargas mantiene progreso en segundo plano.",
  "Tip: Revisa la pestaña de servidores para detectar listados con versión compatible automáticamente.",
  "Minecraft Live: revisa snapshots y pruebas experimentales para bloques y biomas nuevos.",
  "Consejo FrutiLauncher: puedes ajustar la escala UI para pantallas HiDPI en Configuración.",
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

const pauseBootFrame = () =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, 90);
  });

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
  const [bootStepProgress, setBootStepProgress] = useState<number[]>(() =>
    loadingSteps.map((_, index) => (index === 0 ? 15 : 0)),
  );
  const [bootEvents, setBootEvents] = useState<string[]>([]);
  const [activeTip, setActiveTip] = useState(launcherTips[0]);
  const [tipIndex, setTipIndex] = useState(0);
  const bootStartedAt = useRef<number>(Date.now());
  const bootHydrated = useRef(false);

  useEffect(() => {
    const syncViewportHeight = () => {
      document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
    };

    syncViewportHeight();
    window.addEventListener("resize", syncViewportHeight);
    document.addEventListener("visibilitychange", syncViewportHeight);
    window.addEventListener("focus", syncViewportHeight);

    return () => {
      window.removeEventListener("resize", syncViewportHeight);
      document.removeEventListener("visibilitychange", syncViewportHeight);
      window.removeEventListener("focus", syncViewportHeight);
    };
  }, []);

  useEffect(() => {
    const runBoot = async () => {
      let shouldShowVerification = false;
      const updateStepProgress = (index: number, progress: number) => {
        setBootStep(index);
        setBootStepProgress((prev) =>
          prev.map((value, currentIndex) => {
            if (currentIndex < index) {
              return 100;
            }
            if (currentIndex === index) {
              return Math.max(value, Math.min(100, progress));
            }
            return value;
          }),
        );
      };
      try {
        bootStartedAt.current = Date.now();
        setBootStep(0);
        setBootStepProgress(loadingSteps.map((_, index) => (index === 0 ? 15 : 0)));
        const config = await loadConfig();
        shouldShowVerification = Boolean(config.showVerificationWindow);
        setShowVerificationWindow(shouldShowVerification);

        updateStepProgress(0, 100);
        await pauseBootFrame();

        if (shouldShowVerification) {
          updateStepProgress(1, 30);
          await pauseBootFrame();
          const startupFiles = await collectStartupFiles();
          updateStepProgress(1, 100);
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

        updateStepProgress(2, 35);
        await pauseBootFrame();
        const [instancesResult] = await Promise.allSettled([
          fetchInstances(),
          fetchNewsOverview(),
          fetchExplorerItems("Modpacks"),
          fetchServerListings(),
          preloadStartupCatalogs(),
        ]);
        updateStepProgress(2, 100);
        setBootEvents((prev) => [...prev, "Catálogos remotos sincronizados."]);

        if (config.uiScale) {
          setScale(config.uiScale);
        }
        if (config.theme) {
          setTheme(config.theme);
        }
        if (config.activeSection) {
          const normalizedSection =
            (config.activeSection as string) === "novedades" ? "features" : config.activeSection;
          setSection(normalizedSection as Parameters<typeof setSection>[0]);
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

        updateStepProgress(3, 80);
        await pauseBootFrame();
        setBootEvents((prev) => [...prev, "Preferencias de usuario aplicadas."]);
        const loadedInstances =
          instancesResult.status === "fulfilled"
            ? instancesResult.value
            : await fetchInstances();
        setInstances(loadedInstances);
        updateStepProgress(4, 100);
        setBootEvents((prev) => [...prev, "Launcher operativo. ¡Listo para jugar!"]);
      } catch (error) {
        console.error("Error durante el arranque", error);
        setBootEvents((prev) => [
          ...prev,
          "Advertencia: hubo un error al cargar algunos módulos. Continuando...",
        ]);
      } finally {
        const elapsed = Date.now() - bootStartedAt.current;
        const minimumBootDuration = 5_000;
        if (elapsed > minimumBootDuration) {
          const extraDelay = elapsed - minimumBootDuration;
          const details = bootEvents.length ? ` Detalles: ${bootEvents.join(" | ")}` : "";
          void logMessage(
            "instances",
            "warn",
            `Arranque más lento de lo esperado (+${extraDelay}ms).${details}`,
            { flush: true },
          );
        }
        const remaining = Math.max(0, minimumBootDuration - elapsed);
        window.setTimeout(() => setBootReady(true), remaining);
        bootHydrated.current = true;
      }
    };
    void runBoot();
  }, [setScale, setTheme, setSection, isFocusMode, toggleFocus]);

  useEffect(() => {
    if (bootReady) {
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
  }, [bootReady]);

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
    let updatedInstance: Instance | null = null;
    setInstances((prev) =>
      prev.map((instance) => {
        if (instance.id !== instanceId) {
          return instance;
        }
        updatedInstance = { ...instance, ...patch };
        return updatedInstance;
      }),
    );

    if (!updatedInstance) {
      return;
    }

    const shouldPersist =
      patch.name !== undefined ||
      patch.version !== undefined ||
      patch.loaderName !== undefined ||
      patch.loaderVersion !== undefined ||
      patch.javaMode !== undefined ||
      patch.javaPath !== undefined;

    if (shouldPersist) {
      void persistInstanceUpdate(updatedInstance).catch((error) => {
        console.error("No se pudo persistir la edición de la instancia", error);
      });
    }
  };

  const handleDeleteInstance = (instanceId: string) => {
    setInstances((prev) => prev.filter((instance) => instance.id !== instanceId));
    setSelectedInstanceId((prev) => (prev === instanceId ? null : prev));
  };
  const showStatusBar = activeSection === "mis-modpacks" && !isFocusMode;
  const bootProgress = Math.round(
    bootStepProgress.reduce((acc, value) => acc + value, 0) / loadingSteps.length,
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
        {!bootReady && (
          <div className="boot-screen" role="status" aria-live="polite">
            <div className="boot-screen__window">
              <div className="boot-screen__logo" aria-label="FrutiLauncher cargando">
                <p className="boot-screen__eyebrow">FrutiLauncher</p>
                <span>FrutiLauncher</span>
                <p className="boot-screen__subtitle">
                  Preparando entorno de juego
                </p>
              </div>
              <div className="boot-screen__progress" aria-hidden="true">
                <div style={{ width: `${bootProgress}%` }} />
              </div>
              <p className="boot-screen__percent">{bootProgress}%</p>
              <ul>
                {loadingSteps.map((step, index) => {
                  const stepProgress = Math.round(bootStepProgress[index] ?? 0);
                  const done = stepProgress >= 100;
                  const inProgress = index === bootStep && !done;
                  return (
                    <li
                      key={step}
                      className={done ? "is-done" : inProgress ? "is-progress" : ""}
                    >
                      <div className="boot-screen__step-row">
                        <span>{step}</span>
                        <strong>{stepProgress}%</strong>
                      </div>
                      <div className="boot-screen__step-progress" aria-hidden="true">
                        <div style={{ width: `${stepProgress}%` }} />
                      </div>
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
              {showVerificationWindow ? (
                <div className="boot-screen__actions">
                  <button
                    type="button"
                    className="boot-screen__cancel"
                    onClick={() => void handleCancelBoot()}
                  >
                    Salir del launcher
                  </button>
                </div>
              ) : null}
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
              {activeSection === "features" && featureFlags.news && <FeaturesPanel />}
              {activeSection === "comunidad" && featureFlags.community && <CommunityPanel />}
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
