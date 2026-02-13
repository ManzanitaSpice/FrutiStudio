import {
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Instance, Mod } from "../../types/models";
import {
  type MinecraftVersion,
  fetchMinecraftVersions,
} from "../../services/minecraftVersionService";
import {
  createInstance,
  exportInstance,
  importInstance,
  launchInstance,
  preflightInstance,
  readInstanceRuntimeLogs,
  removeInstance,
  repairInstance,
  type RepairMode,
} from "../../services/instanceService";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  type ExternalInstance,
  fetchExternalInstances,
  importExternalInstance,
  scanExternalInstances,
} from "../../services/externalInstanceService";
import { fetchATLauncherPacks } from "../../services/atmlService";
import {
  type ExplorerItem,
  type ExplorerItemFileVersion,
  fetchExplorerItemDetails,
  fetchUnifiedCatalog,
} from "../../services/explorerService";
import { fetchLoaderVersions } from "../../services/loaderVersionService";
import { installModFileToInstance } from "../../services/modService";
import { buildJvmRecommendation } from "../../services/jvmTuningService";
import { formatPlaytime, formatRelativeTime } from "../../utils/formatters";
import importGuide from "../../assets/import-guide.svg";
import {
  createInstanceDesktopShortcut,
  openInstancePath,
} from "../../services/instanceWorkspaceService";

interface InstancePanelProps {
  instances: Instance[];
  selectedInstanceId: string | null;
  onSelectInstance: (id: string) => void;
  onClearSelection: () => void;
  onCreateInstance: (instance: Instance) => void;
  onUpdateInstance: (id: string, patch: Partial<Instance>) => void;
  onDeleteInstance: (id: string) => void;
  isFocusMode: boolean;
  onToggleFocusMode: () => void;
}

const editorSections = [
  "Versión",
  "Mods",
  "Resource Packs",
  "Shader Packs",
  "Mundos",
  "Servidores",
  "Configuración",
  "Notas",
  "Capturas de pantalla",
  "Registro de Minecraft",
  "Otros registros",
];

const creatorSections = [
  "Personalizado",
  "Modrinth",
  "CurseForge",
  "ATLauncher",
  "Importar",
];

const importTabs = [
  "Escaneo automático",
  "Importar desde launcher detectado",
  "Importar desde archivo (zip/mrpack/manifest)",
  "Importar desde carpeta personalizada",
  "Instancias enlazadas",
] as const;

type ImportTab = (typeof importTabs)[number];

const importFlowStates = ["Pendiente", "Validando", "Listo", "Error"] as const;

const instanceConfigTabs = [
  "General",
  "Java",
  "Ajustes",
  "Comandos Personalizados",
  "Variables de Entorno",
] as const;

type InstanceConfigTab = (typeof instanceConfigTabs)[number];

interface InstanceConfigState {
  launchMaximized: boolean;
  windowSize: string;
  hideLauncherOnGameOpen: boolean;
  quitLauncherOnGameClose: boolean;
  showConsoleOnLaunch: boolean;
  showConsoleOnCrash: boolean;
  hideConsoleOnQuit: boolean;
  globalDatapacksPath: string;
  showPlaytime: boolean;
  recordPlaytime: boolean;
  overrideAccount: string;
  autoJoinEnabled: boolean;
  autoJoinServer: string;
  autoJoinWorld: string;
  overrideLoader: string;
  javaOverrideEnabled: boolean;
  javaExecutable: string;
  skipJavaCompatibilityChecks: boolean;
  minMemory: number;
  maxMemory: number;
  permGen: string;
  javaArgs: string;
  customPreLaunchCommand: string;
  customPostExitCommand: string;
  customCrashCommand: string;
  envVariables: string;
}

const defaultInstanceConfig = (): InstanceConfigState => ({
  launchMaximized: false,
  windowSize: "1280x720",
  hideLauncherOnGameOpen: true,
  quitLauncherOnGameClose: false,
  showConsoleOnLaunch: false,
  showConsoleOnCrash: true,
  hideConsoleOnQuit: true,
  globalDatapacksPath: "",
  showPlaytime: true,
  recordPlaytime: true,
  overrideAccount: "Cuenta global",
  autoJoinEnabled: false,
  autoJoinServer: "",
  autoJoinWorld: "",
  overrideLoader: "Auto",
  javaOverrideEnabled: false,
  javaExecutable: "",
  skipJavaCompatibilityChecks: false,
  minMemory: 1024,
  maxMemory: 4096,
  permGen: "128M (Legacy)",
  javaArgs: "-XX:+UseG1GC -XX:MaxGCPauseMillis=200",
  customPreLaunchCommand: "",
  customPostExitCommand: "",
  customCrashCommand: "",
  envVariables: "JAVA_HOME=\nMC_PROFILE=instance",
});

interface StartupProgressState {
  active: boolean;
  progress: number;
  stage: string;
  details?: string;
  startedAt?: number;
  etaSeconds?: number;
}

const transientBackendStatuses = new Set([
  "cleaning_partials",
  "downloading_manifest",
  "downloading_version_metadata",
  "downloading_client",
  "downloading_asset_index",
  "downloading_assets",
  "assets_ready",
  "installing_loader",
  "downloading_libraries",
  "libraries_ready",
  "building_launch_plan",
  "preflight",
  "repairing",
  "repair_fallback_reinstall",
  "repaired",
  "launching",
]);

const formatEta = (etaSeconds?: number): string | null => {
  if (typeof etaSeconds !== "number" || !Number.isFinite(etaSeconds) || etaSeconds <= 0) {
    return null;
  }

  const total = Math.max(1, Math.round(etaSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  if (minutes <= 0) {
    return `~${seconds}s`;
  }

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `~${hours}h ${remMinutes}m` : `~${hours}h`;
  }

  return seconds > 0 ? `~${minutes}m ${seconds}s` : `~${minutes}m`;
};

const mapBackendStepDetail = (detail: unknown): string | undefined => {
  if (typeof detail !== "string") {
    return undefined;
  }

  const normalized = detail.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const labels: Record<string, string> = {
    forge_like: "Instalación Forge/NeoForge",
    forge_like_wait: "Instalador de loader ejecutándose",
    fabric_profile: "Resolviendo perfil de Fabric/Quilt",
    version_manifest: "Leyendo manifiesto oficial",
    asset_index: "Resolviendo índice de assets",
  };

  return labels[normalized] ?? detail;
};

interface CatalogMod {
  id: string;
  name: string;
  version: string;
  provider: "modrinth" | "curseforge";
  type: "Mods" | "Shaders" | "Resource Packs";
  sourceLabel?: string;
  thumbnail?: string;
  gameVersions: string[];
  loaders: string[];
  fileSizeBytes?: number;
}

type ModInstallStage = "idle" | "downloading" | "validating" | "installing" | "completed";

export const InstancePanel = ({
  instances,
  selectedInstanceId,
  onSelectInstance,
  onClearSelection,
  onCreateInstance,
  onUpdateInstance,
  onDeleteInstance,
  isFocusMode,
  onToggleFocusMode,
}: InstancePanelProps) => {
  const [editorOpen, setEditorOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [activeEditorSection, setActiveEditorSection] = useState(editorSections[1]);
  const [activeCreatorSection, setActiveCreatorSection] = useState(creatorSections[0]);
  const [availableVersions, setAvailableVersions] = useState<MinecraftVersion[]>([]);
  const [versionsStatus, setVersionsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState("");
  const [instanceSearch, setInstanceSearch] = useState("");
  const [instanceGroup, setInstanceGroup] = useState("");
  const [instanceVersion, setInstanceVersion] = useState("");
  const [instanceLoader, setInstanceLoader] = useState("Vanilla");
  const [instanceLoaderVersion, setInstanceLoaderVersion] = useState("");
  const [creatorJavaMode, setCreatorJavaMode] = useState<"auto" | "embedded" | "manual">(
    "embedded",
  );
  const [creatorJavaPath, setCreatorJavaPath] = useState("");
  const [versionFilters, setVersionFilters] = useState({
    release: true,
    snapshot: true,
    beta: false,
    alpha: false,
    experimental: false,
  });
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loaderStatus, setLoaderStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [loaderError, setLoaderError] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [activeImportTab, setActiveImportTab] = useState<ImportTab>("Escaneo automático");
  const [scanDepthLimit, setScanDepthLimit] = useState(4);
  const [scanAllVolumes, setScanAllVolumes] = useState(false);
  const [scanStatusText, setScanStatusText] = useState("Pendiente");
  const [scanCancelled, setScanCancelled] = useState(false);
  const [scanStats, setScanStats] = useState<string | null>(null);
  const [externalInstances, setExternalInstances] = useState<ExternalInstance[]>([]);
  const [externalStatus, setExternalStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [externalError, setExternalError] = useState<string | null>(null);
  const [creatorItems, setCreatorItems] = useState<ExplorerItem[]>([]);
  const [creatorStatus, setCreatorStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [creatorError, setCreatorError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [repairModalOpen, setRepairModalOpen] = useState(false);
  const [repairMode, setRepairMode] = useState<RepairMode>("inteligente");
  const [repairQuickOpen, setRepairQuickOpen] = useState(false);
  const [launchStatusByInstance, setLaunchStatusByInstance] = useState<
    Record<string, string>
  >({});
  const [launchChecklistOpen, setLaunchChecklistOpen] = useState(false);
  const [launchChecklistLogs, setLaunchChecklistLogs] = useState<string[]>([]);
  const [launchChecklistChecks, setLaunchChecklistChecks] = useState<
    Array<{ name: string; ok: boolean }>
  >([]);
  const [launchChecklistRunning, setLaunchChecklistRunning] = useState(false);
  const [launchChecklistSummary, setLaunchChecklistSummary] = useState<string | null>(
    null,
  );
  const [launchChecklistDebugState, setLaunchChecklistDebugState] = useState<{
    status?: string;
    details?: Record<string, unknown>;
    command?: string;
    stdoutPath?: string;
    stderrPath?: string;
  } | null>(null);
  const [activeChecklistInstanceId, setActiveChecklistInstanceId] = useState<
    string | null
  >(null);
  const [startupProgressByInstance, setStartupProgressByInstance] = useState<
    Record<string, StartupProgressState>
  >({});
  const launchChecklistRunRef = useRef(0);
  const launchChecklistSeenLinesRef = useRef<Set<string>>(new Set());
  const launchChecklistLastBackendStateRef = useRef<string>("");
  const launchChecklistCancelledRef = useRef(false);
  const checklistLogContainerRef = useRef<HTMLDivElement | null>(null);
  const [editorName, setEditorName] = useState("");
  const [editorGroup, setEditorGroup] = useState("");
  const [editorMemory, setEditorMemory] = useState("4 GB");
  const [installedModsByInstance, setInstalledModsByInstance] = useState<
    Record<string, Mod[]>
  >({});
  const [selectedModId, setSelectedModId] = useState<string | null>(null);
  const [modQuery, setModQuery] = useState("");
  const [modDownloadOpen, setModDownloadOpen] = useState(false);
  const [modDownloadTarget, setModDownloadTarget] = useState<
    "Mods" | "Shaders" | "Resource Packs"
  >("Mods");
  const [modReviewOpen, setModReviewOpen] = useState(false);
  const [modProvider, setModProvider] = useState<"modrinth" | "curseforge">("modrinth");
  const [catalogType, setCatalogType] = useState<"Mods" | "Shaders" | "Resource Packs">(
    "Mods",
  );
  const [catalogMods, setCatalogMods] = useState<CatalogMod[]>([]);
  const [selectedCatalogMods, setSelectedCatalogMods] = useState<CatalogMod[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [installingMods, setInstallingMods] = useState(false);
  const [modInstallStage, setModInstallStage] = useState<ModInstallStage>("idle");
  const [modInstallCurrent, setModInstallCurrent] = useState(0);
  const [modInstallTotal, setModInstallTotal] = useState(0);
  const [modInstallStartedAt, setModInstallStartedAt] = useState<number | null>(null);
  const [detectedDependencyCount, setDetectedDependencyCount] = useState(0);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    instance: Instance | null;
  } | null>(null);
  const [activeConfigTab, setActiveConfigTab] = useState<InstanceConfigTab>("General");
  const [instanceConfigById, setInstanceConfigById] = useState<
    Record<string, InstanceConfigState>
  >({});
  const [runtimeLogByInstance, setRuntimeLogByInstance] = useState<
    Record<string, string[]>
  >({});
  const [javaAdvisorNotes, setJavaAdvisorNotes] = useState<string[]>([]);
  const selectedInstance =
    instances.find((instance) => instance.id === selectedInstanceId) ?? null;
  const selectedInstanceHasValidId = Boolean(
    selectedInstance &&
    typeof selectedInstance.id === "string" &&
    selectedInstance.id.trim().length > 0,
  );
  const selectedLaunchStatus = selectedInstance
    ? (launchStatusByInstance[selectedInstance.id] ?? null)
    : null;

  const setInstanceLaunchStatus = (
    instanceId: string | null | undefined,
    message: string,
  ) => {
    if (!instanceId) {
      return;
    }
    setLaunchStatusByInstance((prev) => ({
      ...prev,
      [instanceId]: message,
    }));
  };

  useEffect(() => {
    checklistLogContainerRef.current?.scrollTo({
      top: checklistLogContainerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [launchChecklistLogs]);

  const updateStartupProgress = (
    instanceId: string,
    patch: Partial<StartupProgressState>,
  ) => {
    setStartupProgressByInstance((prev) => {
      const base = prev[instanceId] ?? {
        active: false,
        progress: 0,
        stage: "Preparando...",
      };
      const next: StartupProgressState = {
        ...base,
        ...patch,
      };

      if ((patch.active ?? next.active) && !next.startedAt) {
        next.startedAt = Date.now();
      }

      if (patch.active === false) {
        next.etaSeconds = undefined;
      }

      return {
        ...prev,
        [instanceId]: next,
      };
    });
  };

  const clearStartupProgress = (instanceId: string) => {
    setStartupProgressByInstance((prev) => {
      if (!(instanceId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });
  };

  const statusLabels: Record<Instance["status"], string> = {
    ready: "Listo para jugar",
    "pending-update": "Actualización pendiente",
    stopped: "Detenida",
  };

  const installedMods = selectedInstance
    ? (installedModsByInstance[selectedInstance.id] ?? [])
    : [];
  const selectedInstalledMod =
    installedMods.find((mod) => mod.id === selectedModId) ?? null;
  const selectedConfig = selectedInstance
    ? (instanceConfigById[selectedInstance.id] ?? defaultInstanceConfig())
    : defaultInstanceConfig();

  const updateSelectedConfig = <K extends keyof InstanceConfigState>(
    key: K,
    value: InstanceConfigState[K],
  ) => {
    if (!selectedInstance) {
      return;
    }
    setInstanceConfigById((prev) => ({
      ...prev,
      [selectedInstance.id]: {
        ...(prev[selectedInstance.id] ?? defaultInstanceConfig()),
        [key]: value,
      },
    }));
  };

  const handleAutoTuneJava = () => {
    if (!selectedInstance) {
      return;
    }

    const navWithMemory = navigator as Navigator & { deviceMemory?: number };
    const deviceMemoryGb =
      typeof navigator !== "undefined" && typeof navWithMemory.deviceMemory === "number"
        ? navWithMemory.deviceMemory
        : 8;

    const recommendation = buildJvmRecommendation({
      javaVersion: 17,
      totalSystemRamMb: Math.round(deviceMemoryGb * 1024),
      modsCount: selectedInstance.mods,
      isClient: true,
      loaderName: selectedInstance.loaderName,
    });

    updateSelectedConfig("minMemory", recommendation.minMemoryMb);
    updateSelectedConfig("maxMemory", recommendation.maxMemoryMb);
    updateSelectedConfig("javaArgs", recommendation.javaArgs.join(" "));
    setJavaAdvisorNotes([
      `Preset aplicado: ${recommendation.preset.label}.`,
      ...recommendation.notes,
    ]);
  };

  const checklistLogLineClass = (line: string) => {
    if (/^✖|\berror\b|\bfalló\b|\bexception\b|\[stderr\]/i.test(line)) {
      return "is-error";
    }
    if (/^⚠|\bwarning\b|\baviso\b|reintentando/i.test(line)) {
      return "is-warning";
    }
    if (/^✅|^✔|completad|running|confirmó estado/i.test(line)) {
      return "is-success";
    }
    if (/^ℹ|^🧩|^🔎|estado backend|debug/i.test(line)) {
      return "is-info";
    }
    return "is-neutral";
  };

  const runLaunchChecklist = async (instanceId: string) => {
    const checklistMaxAttempts = 2;
    const checklistRetryDelayMs = 400;
    const runId = Date.now();
    launchChecklistRunRef.current = runId;
    launchChecklistCancelledRef.current = false;
    launchChecklistSeenLinesRef.current = new Set();
    launchChecklistLastBackendStateRef.current = "";

    setActiveChecklistInstanceId(instanceId);
    setLaunchChecklistOpen(true);
    setLaunchChecklistRunning(true);
    setLaunchChecklistSummary(null);
    setLaunchChecklistChecks([]);
    setLaunchChecklistDebugState(null);
    setLaunchChecklistLogs(["Abriendo verificación previa de instancia..."]);
    updateStartupProgress(instanceId, {
      active: true,
      progress: 8,
      stage: "Iniciando validación",
      details: "Preparando diagnóstico y entorno.",
    });

    const isCurrentRun = () => launchChecklistRunRef.current === runId;

    const appendLog = (line: string) => {
      if (!isCurrentRun()) {
        return;
      }
      setLaunchChecklistLogs((prev) => [...prev, line]);
    };

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
      });

    const runCancelable = async (promise: Promise<unknown>): Promise<unknown> => {
      const cancelPromise: Promise<{ type: "cancel" }> = new Promise((resolve) => {
        const check = () => {
          if (!isCurrentRun() || launchChecklistCancelledRef.current) {
            resolve({ type: "cancel" });
            return;
          }
          window.setTimeout(check, 150);
        };
        check();
      });

      const result: { type: "ok"; value: unknown } | { type: "cancel" } =
        await Promise.race([
          promise.then((value) => ({ type: "ok" as const, value })),
          cancelPromise,
        ]);

      if (result.type === "cancel") {
        throw new Error("Proceso de verificación cancelado por el usuario.");
      }
      return result.value;
    };

    const logBackendState = async () => {
      const statusMap: Record<string, { progress: number; label: string }> = {
        cleaning_partials: { progress: 15, label: "Limpiando descargas temporales" },
        downloading_manifest: { progress: 21, label: "Descargando manifiesto oficial" },
        downloading_version_metadata: {
          progress: 28,
          label: "Descargando metadata de versión",
        },
        downloading_client: { progress: 38, label: "Descargando cliente base" },
        downloading_asset_index: { progress: 46, label: "Descargando índice de assets" },
        downloading_assets: { progress: 52, label: "Descargando assets" },
        assets_ready: { progress: 58, label: "Assets descargados" },
        installing_loader: { progress: 64, label: "Instalando loader" },
        installing_loader_waiting: {
          progress: 66,
          label: "Instalador del loader ejecutándose",
        },
        downloading_libraries: { progress: 70, label: "Descargando librerías" },
        libraries_ready: { progress: 76, label: "Librerías listas" },
        building_launch_plan: { progress: 82, label: "Generando plan de arranque" },
        preflight: { progress: 86, label: "Verificando estructura" },
        repairing: { progress: 90, label: "Reparando instancia" },
        repair_fallback_reinstall: {
          progress: 92,
          label: "Recreando instancia desde cero",
        },
        repaired: { progress: 95, label: "Reparación completada" },
        launching: { progress: 88, label: "Inicializando runtime Java" },
        running: { progress: 100, label: "Instancia ejecutándose" },
      };
      try {
        const snapshot = await readInstanceRuntimeLogs(instanceId);
        const status = snapshot.status ?? "";
        if (!isCurrentRun()) {
          return;
        }

        setLaunchChecklistDebugState({
          status: snapshot.status,
          details: snapshot.stateDetails,
          command: snapshot.command,
          stdoutPath: snapshot.stdoutPath,
          stderrPath: snapshot.stderrPath,
        });

        const step =
          typeof snapshot.stateDetails?.step === "string"
            ? snapshot.stateDetails.step.toLowerCase()
            : "";
        const mappedStatus =
          status === "installing_loader" && step === "forge_like_wait"
            ? statusMap.installing_loader_waiting
            : statusMap[status];

        const progressValue =
          typeof snapshot.stateDetails?.progress === "number"
            ? snapshot.stateDetails.progress
            : undefined;
        const hasExplicitProgress =
          typeof progressValue === "number" && Number.isFinite(progressValue);

        const unseenLines = snapshot.lines.filter((line) => {
          const lineKey = `${snapshot.status ?? "no-status"}:${line}`;
          if (launchChecklistSeenLinesRef.current.has(lineKey)) {
            return false;
          }
          launchChecklistSeenLinesRef.current.add(lineKey);
          return true;
        });

        unseenLines.slice(-12).forEach((line) => {
          if (/\[stderr\]|error|falló|exception/i.test(line)) {
            appendLog(`🔎 Backend: ${line}`);
          } else if (/\[event\]/i.test(line)) {
            appendLog(`🧩 ${line}`);
          }
        });

        const backendErrors = unseenLines
          .filter((line) => /falló|error|\[stderr\]/i.test(line))
          .slice(-2);
        backendErrors.forEach((line) => appendLog(`🔎 Backend: ${line}`));

        if (
          status === "downloading_assets" &&
          typeof snapshot.stateDetails?.completed === "number" &&
          typeof snapshot.stateDetails?.total === "number"
        ) {
          appendLog(
            `ℹ Assets: ${snapshot.stateDetails.completed}/${snapshot.stateDetails.total} (${snapshot.stateDetails.progress ?? 0}%).`,
          );
        }

        if (
          status === "downloading_libraries" &&
          typeof snapshot.stateDetails?.total === "number"
        ) {
          appendLog(
            `ℹ Librerías: total ${snapshot.stateDetails.total}, concurrencia ${snapshot.stateDetails.concurrency ?? "?"}.`,
          );
        }

        if (mappedStatus) {
          updateStartupProgress(instanceId, {
            active: mappedStatus.progress < 100,
            progress: hasExplicitProgress ? progressValue : mappedStatus.progress,
            stage: mappedStatus.label,
            details: mapBackendStepDetail(snapshot.stateDetails?.step),
          });

          setStartupProgressByInstance((prev) => {
            const current = prev[instanceId];
            if (!current?.active || !current.startedAt) {
              return prev;
            }
            const elapsedSeconds = Math.max(
              1,
              Math.floor((Date.now() - current.startedAt) / 1000),
            );
            const progress = Math.max(1, Math.min(99, Math.round(current.progress)));
            const estimatedTotalSeconds = Math.round((elapsedSeconds * 100) / progress);
            const etaSeconds = Math.max(1, estimatedTotalSeconds - elapsedSeconds);
            if (current.etaSeconds === etaSeconds) {
              return prev;
            }
            return {
              ...prev,
              [instanceId]: {
                ...current,
                etaSeconds,
              },
            };
          });

          const backendStateKey = `${status}:${JSON.stringify(snapshot.stateDetails ?? {})}`;
          if (launchChecklistLastBackendStateRef.current !== backendStateKey) {
            launchChecklistLastBackendStateRef.current = backendStateKey;
            appendLog(`ℹ Estado backend: ${mappedStatus.label}.`);
          }
        }
      } catch {
        // Ignorar errores de lectura de estado durante polling.
      }
    };

    let keepPolling = true;
    const pollBackendContinuously = async () => {
      while (isCurrentRun() && keepPolling) {
        await logBackendState();
        await wait(900);
      }
    };

    const runTimedPreflight = async (phaseLabel: string, progress: number) => {
      appendLog(phaseLabel);
      updateStartupProgress(instanceId, {
        active: true,
        progress,
        stage: "Validando estructura y runtime",
      });
      await logBackendState();
      let latestReport = (await runCancelable(preflightInstance(instanceId))) as any;

      for (
        let attempt = 1;
        isCurrentRun() && !latestReport.ok && attempt < checklistMaxAttempts;
        attempt += 1
      ) {
        appendLog(
          "⚠ Inconsistencia temporal detectada. Reintentando verificación rápida...",
        );
        await wait(checklistRetryDelayMs);
        if (!isCurrentRun()) {
          throw new Error("Proceso de verificación cancelado por el usuario.");
        }
        latestReport = (await runCancelable(preflightInstance(instanceId))) as any;
      }

      return latestReport;
    };

    const printChecklist = (checks: Record<string, boolean>) => {
      const items = Object.entries(checks).map(([name, ok]) => ({ name, ok }));
      setLaunchChecklistChecks(items);
      items.forEach((check) => {
        appendLog(`${check.ok ? "✔" : "✖"} ${check.name}`);
      });
    };

    try {
      const pollerPromise = pollBackendContinuously();
      let report = await runTimedPreflight(
        "1/4: Revisando estructura, runtime y archivos críticos de la instancia (si falta runtime se descargará y puede tardar)...",
        45,
      );
      appendLog("2/4: Validando checklist técnico de arranque...");
      updateStartupProgress(instanceId, {
        active: true,
        progress: 62,
        stage: "Validación técnica",
      });
      printChecklist(report.checks);

      if (!report.ok) {
        appendLog(
          "✖ La verificación inicial encontró inconsistencias. Iniciando reparación profesional por fases...",
        );
        appendLog(
          "3/4: Reinstalando componentes base y regenerando plan de lanzamiento...",
        );
        updateStartupProgress(instanceId, {
          active: true,
          progress: 72,
          stage: "Reparando estructura",
        });
        await runCancelable(repairInstance(instanceId));
        appendLog("Reparación completada. Ejecutando validación final...");

        report = await runTimedPreflight(
          "4/4: Revalidando estructura tras la reparación...",
          84,
        );
        printChecklist(report.checks);
      }

      if (report.warnings.length > 0) {
        report.warnings.forEach((warning: string) => {
          appendLog(`⚠ Aviso: ${warning}`);
        });
      }

      if (!report.ok) {
        report.errors.forEach((error: string) => {
          appendLog(`✖ Error: ${error}`);
        });
        throw new Error(
          report.errors.join("; ") ||
            "La validación previa de la instancia falló incluso después de la reparación.",
        );
      }

      appendLog("Checklist completo, iniciando Java...");
      updateStartupProgress(instanceId, {
        active: true,
        progress: 92,
        stage: "Lanzando Java",
      });
      setLaunchChecklistSummary("✅ Verificación finalizada correctamente.");
      keepPolling = false;
      await pollerPromise;
      return report;
    } finally {
      keepPolling = false;
      if (isCurrentRun()) {
        setLaunchChecklistRunning(false);
      }
    }
  };

  const openChecklistWithContext = (instanceId: string, summary?: string) => {
    setActiveChecklistInstanceId(instanceId);
    setLaunchChecklistOpen(true);
    setLaunchChecklistRunning(false);
    if (summary) {
      setLaunchChecklistSummary(summary);
    }
    setLaunchChecklistChecks([]);
    setLaunchChecklistDebugState(null);
    setLaunchChecklistLogs((prev) =>
      prev.length > 0
        ? prev
        : [
            'Esperando una ejecución manual del checklist. Pulsa "Iniciar" para correr la validación completa.',
          ],
    );
  };

  const runRepairFlow = async (mode: RepairMode) => {
    if (!selectedInstance) {
      return;
    }
    setRepairQuickOpen(false);
    setRepairModalOpen(false);
    const modeLabel = {
      inteligente: "Reparación inteligente",
      completa: "Reparación completa",
      solo_verificar: "Solo verificar",
      solo_mods: "Reparar solo mods",
      reinstalar_loader: "Reinstalar loader",
      reparar_y_optimizar: "Reparar y optimizar",
      verificar_integridad: "Verificar integridad (limpiar JSON)",
    }[mode];
    try {
      setInstanceLaunchStatus(selectedInstance.id, `Ejecutando ${modeLabel}...`);
      const report = await repairInstance(selectedInstance.id, mode);
      setInstanceLaunchStatus(
        selectedInstance.id,
        report.issuesDetected.length === 0
          ? "No se encontraron problemas."
          : `Reparación completada · libs: ${report.librariesFixed}, assets: ${report.assetsFixed}, mods: ${report.modsFixed}`,
      );
      onUpdateInstance(selectedInstance.id, {
        status: "ready",
        isRunning: false,
        processId: undefined,
      });
    } catch (error) {
      setInstanceLaunchStatus(
        selectedInstance.id,
        error instanceof Error
          ? `No se pudo reparar la instancia: ${error.message}`
          : "No se pudo reparar la instancia.",
      );
    }
  };

  const instanceHealth = useMemo(() => {
    if (!selectedInstance) {
      return { icon: "✔", label: "Instancia correcta" };
    }
    if (selectedLaunchStatus?.toLowerCase().includes("no se pudo")) {
      return { icon: "❌", label: "Instancia con error" };
    }
    if (selectedInstance.status === "pending-update") {
      return { icon: "⚠", label: "Requiere revisión" };
    }
    return { icon: "✔", label: selectedInstance.isRunning ? "En ejecución" : "Lista" };
  }, [selectedLaunchStatus, selectedInstance]);

  const primaryAction = useMemo(() => {
    if (!selectedInstanceHasValidId || !selectedInstance) {
      return { label: "▶ Iniciar", disabled: true, action: () => undefined };
    }
    const hasPid = typeof selectedInstance.processId === "number";
    const startupState = startupProgressByInstance[selectedInstance.id];
    if (selectedLaunchStatus?.toLowerCase().includes("no se pudo")) {
      return {
        label: "🔧 Reparar instancia",
        disabled: false,
        action: () => {
          setRepairMode("inteligente");
          setRepairModalOpen(true);
        },
      };
    }
    if (selectedInstance.isRunning) {
      return {
        label: "⏹ Detener",
        disabled: !hasPid,
        action: () =>
          onUpdateInstance(selectedInstance.id, {
            isRunning: false,
            processId: undefined,
            status: "stopped",
          }),
      };
    }
    if (startupState?.active) {
      return {
        label: "⏳ Iniciando...",
        disabled: false,
        action: async () => {
          const confirmRestart = window.confirm(
            `La instancia "${selectedInstance.name}" ya se está inicializando. ¿Deseas intentar iniciar una ejecución individual nueva?`,
          );
          if (!confirmRestart) {
            return;
          }
          openChecklistWithContext(
            selectedInstance.id,
            "Existe una inicialización en curso. Puedes abrir la consola o volver a intentar el inicio manual.",
          );
        },
      };
    }
    return {
      label: "▶ Iniciar",
      disabled: false,
      action: async () => {
        openChecklistWithContext(selectedInstance.id);
        setLaunchChecklistSummary(null);
        updateStartupProgress(selectedInstance.id, {
          active: true,
          progress: 6,
          stage: "Preparando inicio",
        });
        try {
          setInstanceLaunchStatus(selectedInstance?.id, "Iniciando Minecraft...");
          await runLaunchChecklist(selectedInstance.id);
          setLaunchChecklistLogs((prev) => [
            ...prev,
            "3/4: Lanzando proceso Java de Minecraft...",
          ]);
          const result = await launchInstance(selectedInstance.id);
          setLaunchChecklistLogs((prev) => [
            ...prev,
            "4/4: Proceso de Minecraft lanzado correctamente.",
          ]);
          await (async () => {
            const maxPolls = 8;
            for (let attempt = 0; attempt < maxPolls; attempt += 1) {
              const snapshot = await readInstanceRuntimeLogs(selectedInstance.id);
              if (snapshot.status === "running") {
                setLaunchChecklistLogs((prev) => [
                  ...prev,
                  "✅ Backend confirmó estado running.",
                ]);
                break;
              }
              await new Promise<void>((resolve) => {
                window.setTimeout(resolve, 250);
              });
            }
          })();
          updateStartupProgress(selectedInstance.id, {
            active: false,
            progress: 100,
            stage: "Instancia iniciada",
          });
          onUpdateInstance(selectedInstance.id, {
            isRunning: true,
            processId: result.pid,
            status: "ready",
            isDownloading: false,
            downloadProgress: 100,
            downloadStage: "finalizando",
            lastPlayed: new Date().toISOString(),
          });
          setInstanceLaunchStatus(
            selectedInstance?.id,
            "Instancia iniciada correctamente.",
          );
          window.setTimeout(() => {
            setLaunchChecklistOpen(false);
            setActiveChecklistInstanceId(null);
          }, 900);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "No se pudo iniciar la instancia.";
          setInstanceLaunchStatus(
            selectedInstance?.id,
            `${message} Usa "Reparar instancia" para corregirlo.`,
          );
          setLaunchChecklistSummary(`❌ ${message}`);
          setLaunchChecklistLogs((prev) => [...prev, `✖ Inicio detenido: ${message}`]);
          updateStartupProgress(selectedInstance.id, {
            active: false,
            stage: "Error durante inicio",
          });
        }
      },
    };
  }, [
    selectedLaunchStatus,
    onUpdateInstance,
    selectedInstance,
    selectedInstanceHasValidId,
    startupProgressByInstance,
  ]);

  const versionRows = [
    { name: "Minecraft", version: selectedInstance?.version ?? "—" },
    {
      name: selectedInstance?.loaderName ?? "Loader",
      version: selectedInstance?.loaderVersion ?? "—",
    },
  ];

  const groupedInstances = useMemo(() => {
    const normalizedSearch = instanceSearch.trim().toLowerCase();
    const visibleInstances =
      normalizedSearch.length === 0
        ? instances
        : instances.filter((instance) => {
            const haystack = [
              instance.name,
              instance.group,
              instance.version,
              instance.loaderName,
              instance.loaderVersion,
            ]
              .join(" ")
              .toLowerCase();
            return haystack.includes(normalizedSearch);
          });

    const groupMap = new Map<string, Instance[]>();
    visibleInstances.forEach((instance) => {
      const groupName =
        instance.group && instance.group.trim().length > 0
          ? instance.group
          : "No agrupado";
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, []);
      }
      groupMap.get(groupName)?.push(instance);
    });
    return Array.from(groupMap.entries()).sort(([left], [right]) => {
      if (left === "No agrupado") {
        return -1;
      }
      if (right === "No agrupado") {
        return 1;
      }
      return left.localeCompare(right, "es", { sensitivity: "base" });
    });
  }, [instanceSearch, instances]);

  const openEditor = () => {
    if (selectedInstance) {
      setEditorName(selectedInstance.name);
      setEditorGroup(selectedInstance.group);
      setEditorMemory(selectedInstance.memory);
    }
    setEditorOpen(true);
    setContextMenu(null);
  };

  const closeEditor = () => {
    setEditorOpen(false);
  };

  const openCreator = () => {
    setCreatorOpen(true);
    setContextMenu(null);
  };

  const detectJavaFromSystem = () => {
    updateSelectedConfig("javaOverrideEnabled", false);
    updateSelectedConfig("javaExecutable", "");
    setJavaAdvisorNotes((prev) => [
      "Se activó el modo automático: Interface detectará Java instalado y elegirá el más compatible al iniciar.",
      ...prev.filter((note) => !note.includes("modo automático")),
    ]);
  };

  const browseJavaExecutable = async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Seleccionar ejecutable de Java",
        filters: [
          {
            name: "Java",
            extensions: ["exe", "bin", "cmd", "bat", "sh"],
          },
        ],
      });
      if (typeof selected === "string" && selected.trim().length > 0) {
        updateSelectedConfig("javaOverrideEnabled", true);
        updateSelectedConfig("javaExecutable", selected);
        setJavaAdvisorNotes((prev) => [
          `Java manual seleccionado: ${selected}`,
          ...prev.filter((note) => !note.startsWith("Java manual seleccionado:")),
        ]);
      }
    } catch (error) {
      setJavaAdvisorNotes((prev) => [
        error instanceof Error
          ? `No se pudo seleccionar Java manual: ${error.message}`
          : "No se pudo seleccionar Java manual.",
        ...prev,
      ]);
    }
  };

  const testJavaSettings = () => {
    const javaPath = selectedConfig.javaExecutable.trim();
    if (!selectedConfig.javaOverrideEnabled || javaPath.length === 0) {
      setJavaAdvisorNotes((prev) => [
        "Sin override activo: se usará Java embebido de Interface y la configuración es válida.",
        ...prev,
      ]);
      return;
    }

    const looksValid =
      javaPath.toLowerCase().includes("java") || javaPath.endsWith(".exe");
    setJavaAdvisorNotes((prev) => [
      looksValid
        ? "Ruta Java manual validada localmente. Si falla al iniciar, revisa permisos y versión requerida por Minecraft."
        : "La ruta Java no parece un ejecutable válido. Verifica el archivo antes de iniciar.",
      ...prev,
    ]);
  };

  const openJavaDownloader = () => {
    window.open(
      "https://adoptium.net/temurin/releases/",
      "_blank",
      "noopener,noreferrer",
    );
  };

  const openInstanceSubPath = async (subPath?: string, label?: string) => {
    if (!selectedInstance) {
      return;
    }
    try {
      await openInstancePath(selectedInstance.id, subPath);
      if (label) {
        setInstanceLaunchStatus(
          selectedInstance?.id,
          `Abriendo ${label} de ${selectedInstance.name}...`,
        );
      }
    } catch (error) {
      setInstanceLaunchStatus(
        selectedInstance?.id,
        error instanceof Error
          ? `No se pudo abrir ${label ?? "la carpeta"}: ${error.message}`
          : `No se pudo abrir ${label ?? "la carpeta"}.`,
      );
    }
  };

  const createDesktopShortcutForSelected = async () => {
    if (!selectedInstance) {
      return;
    }
    try {
      const createdPath = await createInstanceDesktopShortcut(selectedInstance.id);
      setInstanceLaunchStatus(
        selectedInstance?.id,
        `Atajo creado en el escritorio: ${createdPath}`,
      );
    } catch (error) {
      setInstanceLaunchStatus(
        selectedInstance?.id,
        error instanceof Error
          ? `No se pudo crear el atajo: ${error.message}`
          : "No se pudo crear el atajo en escritorio.",
      );
    }
  };
  const quickActions = useMemo(() => {
    if (!selectedInstance) {
      return { frequent: [], management: [] };
    }
    return {
      frequent: [
        { id: "edit", label: "Editar", action: openEditor },
        {
          id: "folder",
          label: "Abrir carpeta",
          action: () => {
            void openInstanceSubPath(undefined, "la carpeta de instancia");
          },
        },
        {
          id: "mods",
          label: "Gestionar mods",
          action: () => {
            openEditor();
            setActiveEditorSection("Mods");
          },
        },
      ],
      management: [
        {
          id: "repair",
          label: "Reparar",
          action: () => {
            setRepairMode("inteligente");
            setRepairModalOpen(true);
          },
        },
        {
          id: "export",
          label: "Exportar",
          action: () => {
            void (async () => {
              try {
                const target = await save({
                  defaultPath: `${selectedInstance.id}.zip`,
                  filters: [{ name: "Instancia", extensions: ["zip"] }],
                });
                if (!target || Array.isArray(target)) {
                  return;
                }
                await exportInstance(selectedInstance.id, target);
                setInstanceLaunchStatus(
                  selectedInstance?.id,
                  `Instancia exportada correctamente a ${target}.`,
                );
              } catch (error) {
                setInstanceLaunchStatus(
                  selectedInstance?.id,
                  error instanceof Error
                    ? `No se pudo exportar la instancia: ${error.message}`
                    : "No se pudo exportar la instancia.",
                );
              }
            })();
          },
        },
        {
          id: "copy",
          label: "Duplicar",
          action: () =>
            onCreateInstance({
              ...selectedInstance,
              id: `${selectedInstance.id}-copy-${Date.now()}`,
              name: `${selectedInstance.name} (Copia)`,
              isRunning: false,
              processId: undefined,
              status: "stopped",
            }),
        },
        {
          id: "group",
          label: "Grupo",
          action: () =>
            onUpdateInstance(selectedInstance.id, {
              group:
                selectedInstance.group === "No agrupado" ? "Favoritos" : "No agrupado",
            }),
        },
        {
          id: "shortcut",
          label: "Atajo escritorio",
          action: () => {
            void createDesktopShortcutForSelected();
          },
        },
      ],
    };
  }, [
    createDesktopShortcutForSelected,
    onCreateInstance,
    onUpdateInstance,
    openInstanceSubPath,
    selectedInstance,
  ]);

  useEffect(() => {
    if (!creatorOpen || versionsStatus !== "idle") {
      return;
    }
    const loadVersions = async () => {
      setVersionsStatus("loading");
      setVersionsError(null);
      try {
        const versions = await fetchMinecraftVersions();
        setAvailableVersions(versions);
        setVersionsStatus("ready");
      } catch (error) {
        setVersionsStatus("error");
        setVersionsError(
          error instanceof Error
            ? error.message
            : "No se pudo cargar la lista de versiones.",
        );
      }
    };
    void loadVersions();
  }, [availableVersions.length, creatorOpen, versionsStatus]);

  const resolveVersionType = (version: MinecraftVersion) => {
    if (version.type === "snapshot" && /experimental/i.test(version.id)) {
      return "experimental";
    }
    if (version.type === "snapshot") {
      return "snapshot";
    }
    if (version.type === "old_beta") {
      return "beta";
    }
    if (version.type === "old_alpha") {
      return "alpha";
    }
    return "release";
  };

  const filteredVersions = useMemo(() => {
    if (!availableVersions.length) {
      return [];
    }
    return availableVersions.filter((version) => {
      const kind = resolveVersionType(version);
      return versionFilters[kind as keyof typeof versionFilters];
    });
  }, [availableVersions, versionFilters]);

  const preferredVersion = useMemo(() => {
    if (!filteredVersions.length) {
      return null;
    }

    return (
      filteredVersions.find((version) => version.type === "release") ??
      filteredVersions[0]
    );
  }, [filteredVersions]);

  useEffect(() => {
    if (!instanceVersion && preferredVersion) {
      setInstanceVersion(preferredVersion.id);
    }
  }, [instanceVersion, preferredVersion]);

  useEffect(() => {
    if (!instanceVersion) {
      return;
    }
    if (!filteredVersions.find((version) => version.id === instanceVersion)) {
      setInstanceVersion(filteredVersions[0]?.id ?? "");
    }
  }, [filteredVersions, instanceVersion]);

  useEffect(() => {
    if (instanceLoader === "Vanilla") {
      setInstanceLoaderVersion("");
    }
  }, [instanceLoader]);

  useEffect(() => {
    if (instanceLoader === "Vanilla" || !instanceVersion) {
      setLoaderVersions([]);
      setLoaderStatus("idle");
      setLoaderError(null);
      return;
    }
    let isActive = true;
    const loadVersions = async () => {
      setLoaderStatus("loading");
      setLoaderError(null);
      try {
        const versions = await fetchLoaderVersions(
          instanceLoader as "Vanilla" | "NeoForge" | "Forge" | "Fabric" | "Quilt",
          instanceVersion,
        );
        if (isActive) {
          setLoaderVersions(versions);
          setLoaderStatus("ready");
          if (versions.length && !versions.includes(instanceLoaderVersion)) {
            setInstanceLoaderVersion(versions[0]);
          }
        }
      } catch (error) {
        if (isActive) {
          setLoaderVersions([]);
          setLoaderStatus("error");
          setLoaderError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar las versiones del loader.",
          );
        }
      }
    };

    void loadVersions();
    return () => {
      isActive = false;
    };
  }, [instanceLoader, instanceLoaderVersion, instanceVersion]);

  useEffect(() => {
    if (!creatorOpen) {
      return;
    }
    const sourceSections = ["Modrinth", "CurseForge", "ATLauncher"];
    if (!sourceSections.includes(activeCreatorSection)) {
      return;
    }
    let isActive = true;
    const loadCreatorItems = async () => {
      setCreatorStatus("loading");
      setCreatorError(null);
      try {
        if (activeCreatorSection === "ATLauncher") {
          const packs = await fetchATLauncherPacks();
          if (isActive) {
            setCreatorItems(
              packs.slice(0, 8).map((pack) => ({
                id: `atlauncher-${pack.id}`,
                projectId: String(pack.id),
                name: pack.name,
                author: "ATLauncher",
                downloads: pack.versions ? `${pack.versions} versiones` : "Disponible",
                rawDownloads: 0,
                description: "Pack disponible en ATLauncher",
                type: "Modpack",
                source: "ATLauncher",
                versions: [],
                loaders: [],
                url: `https://atlauncher.com/pack/${pack.id}`,
              })),
            );
            setCreatorStatus("ready");
          }
          return;
        }
        const targetPlatform =
          activeCreatorSection === "Modrinth" ? "modrinth" : "curseforge";
        const aggregated: ExplorerItem[] = [];
        let page = 0;
        const maxCreatorPages = 6;

        while (page < maxCreatorPages) {
          const pageResult = await fetchUnifiedCatalog({
            category: "Modpacks",
            platform: targetPlatform,
            sort: "popular",
            page,
            pageSize: 24,
          });
          aggregated.push(...pageResult.items);
          if (!pageResult.hasMore || pageResult.items.length === 0) {
            break;
          }
          page += 1;
        }

        if (isActive) {
          setCreatorItems(aggregated);
          setCreatorStatus("ready");
        }
      } catch (error) {
        if (isActive) {
          setCreatorItems([]);
          setCreatorStatus("error");
          setCreatorError(
            error instanceof Error
              ? error.message
              : "No se pudo cargar la lista de modpacks.",
          );
        }
      }
    };

    void loadCreatorItems();
    return () => {
      isActive = false;
    };
  }, [activeCreatorSection, creatorOpen]);

  useEffect(() => {
    if (!selectedInstance) {
      setSelectedModId(null);
      return;
    }
    setInstalledModsByInstance((prev) => {
      if (prev[selectedInstance.id]) {
        return prev;
      }
      return {
        ...prev,
        [selectedInstance.id]: [],
      };
    });
    setInstanceConfigById((prev) => {
      if (prev[selectedInstance.id]) {
        return prev;
      }
      return { ...prev, [selectedInstance.id]: defaultInstanceConfig() };
    });
    setRuntimeLogByInstance((prev) => {
      if (prev[selectedInstance.id]) {
        return prev;
      }
      return {
        ...prev,
        [selectedInstance.id]: [
          `[${new Date().toLocaleTimeString()}] [Launcher] Instancia preparada: ${selectedInstance.name}`,
        ],
      };
    });
  }, [selectedInstance]);

  useEffect(() => {
    if (!selectedInstance) {
      return;
    }

    let isActive = true;
    const pollRuntimeLogs = async () => {
      try {
        const snapshot = await readInstanceRuntimeLogs(selectedInstance.id);
        if (!isActive) {
          return;
        }
        setRuntimeLogByInstance((prev) => ({
          ...prev,
          [selectedInstance.id]: snapshot.lines.slice(-240),
        }));
        const backendStatusMap: Record<
          string,
          { progress: number; label: string; active: boolean }
        > = {
          cleaning_partials: {
            progress: 12,
            label: "Limpiando temporales de descarga",
            active: true,
          },
          downloading_manifest: {
            progress: 22,
            label: "Descargando manifiesto",
            active: true,
          },
          downloading_version_metadata: {
            progress: 30,
            label: "Descargando metadata de versión",
            active: true,
          },
          downloading_client: {
            progress: 40,
            label: "Descargando cliente base",
            active: true,
          },
          downloading_asset_index: {
            progress: 48,
            label: "Descargando índice de assets",
            active: true,
          },
          downloading_assets: {
            progress: 58,
            label: "Descargando assets de Minecraft",
            active: true,
          },
          assets_ready: {
            progress: 62,
            label: "Assets listos",
            active: true,
          },
          installing_loader: {
            progress: 68,
            label: "Instalando loader",
            active: true,
          },
          downloading_libraries: {
            progress: 74,
            label: "Descargando librerías",
            active: true,
          },
          libraries_ready: {
            progress: 80,
            label: "Librerías listas",
            active: true,
          },
          building_launch_plan: {
            progress: 86,
            label: "Generando plan de arranque",
            active: true,
          },
          preflight: {
            progress: 90,
            label: "Verificando estructura de instancia",
            active: true,
          },
          repairing: { progress: 93, label: "Reparando instancia", active: true },
          repair_fallback_reinstall: {
            progress: 95,
            label: "Recreando instancia desde cero",
            active: true,
          },
          repaired: {
            progress: 97,
            label: "Reparación terminada",
            active: true,
          },
          instance_updated: {
            progress: 0,
            label: "Configuración de instancia actualizada",
            active: false,
          },
          launching: {
            progress: 92,
            label: "Inicializando runtime Java",
            active: true,
          },
          running: { progress: 100, label: "Instancia ejecutándose", active: false },
          stopped: { progress: 100, label: "Instancia detenida", active: false },
          crashed: { progress: 100, label: "Instancia cerrada con error", active: false },
          error: { progress: 100, label: "Fallo durante inicialización", active: false },
        };

        const backendStatus = snapshot.status ?? "";
        if (backendStatus && backendStatusMap[backendStatus]) {
          const mapped = backendStatusMap[backendStatus];
          const nowSeconds = Math.floor(Date.now() / 1000);
          const stateAgeSeconds =
            typeof snapshot.stateUpdatedAt === "number"
              ? Math.max(0, nowSeconds - snapshot.stateUpdatedAt)
              : Number.POSITIVE_INFINITY;
          const shouldRespectTransientState =
            transientBackendStatuses.has(backendStatus) &&
            stateAgeSeconds <= 90 &&
            (launchChecklistRunning ||
              startupProgressByInstance[selectedInstance.id]?.active);

          if (
            transientBackendStatuses.has(backendStatus) &&
            !shouldRespectTransientState
          ) {
            clearStartupProgress(selectedInstance.id);
            setInstanceLaunchStatus(selectedInstance.id, "Esperando inicio manual");
            return;
          }

          updateStartupProgress(selectedInstance.id, {
            active: mapped.active && shouldRespectTransientState,
            progress: mapped.progress,
            stage:
              mapped.active && !shouldRespectTransientState
                ? "Esperando inicio manual"
                : mapped.label,
            details: mapBackendStepDetail(snapshot.stateDetails?.step),
          });
          setInstanceLaunchStatus(
            selectedInstance.id,
            mapped.active && !shouldRespectTransientState
              ? "Esperando inicio manual"
              : mapped.label,
          );
        }
      } catch {
        if (!isActive) {
          return;
        }
        setRuntimeLogByInstance((prev) => ({
          ...prev,
          [selectedInstance.id]: [
            ...(prev[selectedInstance.id] ?? []).slice(-30),
            `[${new Date().toLocaleTimeString()}] [Launcher] No se pudieron leer los logs reales de ejecución.`,
          ],
        }));
      }
    };

    void pollRuntimeLogs();
    const interval = window.setInterval(
      () => {
        void pollRuntimeLogs();
      },
      selectedInstance.isRunning || startupProgressByInstance[selectedInstance.id]?.active
        ? 1200
        : 3500,
    );

    return () => {
      isActive = false;
      window.clearInterval(interval);
    };
  }, [
    selectedInstance?.id,
    selectedInstance?.isRunning,
    startupProgressByInstance,
    launchChecklistRunning,
  ]);

  useEffect(() => {
    if (!selectedInstance && editorOpen) {
      setEditorOpen(false);
    }
  }, [editorOpen, selectedInstance]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const handleClose = () => setContextMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("click", handleClose);
    window.addEventListener("contextmenu", handleClose);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("click", handleClose);
      window.removeEventListener("contextmenu", handleClose);
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (launchChecklistOpen) {
        setLaunchChecklistOpen(false);
        return;
      }
      if (modReviewOpen) {
        setModReviewOpen(false);
        return;
      }
      if (modDownloadOpen) {
        setModDownloadOpen(false);
        return;
      }
      if (repairModalOpen) {
        setRepairModalOpen(false);
        return;
      }
      if (deleteConfirmId) {
        setDeleteConfirmId(null);
        return;
      }
      if (editorOpen) {
        setEditorOpen(false);
        return;
      }
      if (creatorOpen) {
        setCreatorOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [
    creatorOpen,
    deleteConfirmId,
    editorOpen,
    launchChecklistOpen,
    modDownloadOpen,
    modReviewOpen,
    repairModalOpen,
  ]);

  const normalizeLoader = (value?: string) => {
    const normalized = (value ?? "").trim().toLowerCase();
    if (!normalized) {
      return "";
    }
    if (normalized === "neo-forge") {
      return "neoforge";
    }
    return normalized;
  };

  const findCompatibleVersion = (versions: ExplorerItemFileVersion[]) => {
    if (!selectedInstance) {
      return null;
    }
    const instanceLoader = normalizeLoader(selectedInstance.loaderName);
    const isVanilla = instanceLoader === "" || instanceLoader === "vanilla";

    const candidates = versions.filter((version) => {
      const matchesVersion =
        version.gameVersions.length === 0 ||
        version.gameVersions.includes(selectedInstance.version);
      if (!matchesVersion) {
        return false;
      }
      if (isVanilla || catalogType !== "Mods") {
        return true;
      }
      const normalizedLoaders = version.loaders.map((loader) => normalizeLoader(loader));
      return normalizedLoaders.length === 0 || normalizedLoaders.includes(instanceLoader);
    });

    const stable = candidates.find((version) => version.releaseType === "release");
    return stable ?? candidates[0] ?? null;
  };

  const loadCatalogMods = async () => {
    if (!selectedInstance) {
      return;
    }
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const found = await fetchUnifiedCatalog({
        query: modQuery.trim(),
        category: catalogType,
        platform: modProvider,
        gameVersion: selectedInstance.version,
        loader:
          selectedInstance.loaderName.toLowerCase() === "vanilla"
            ? undefined
            : selectedInstance.loaderName.toLowerCase(),
        sort: "popular",
        page: 0,
        pageSize: 24,
      });

      const compatibleItems: CatalogMod[] = [];
      for (const item of found.items) {
        const detailItem: ExplorerItem = {
          id: `${item.source}-${item.projectId}`,
          projectId: item.projectId,
          name: item.name,
          author: item.author,
          downloads: item.downloads,
          rawDownloads: item.rawDownloads,
          description: item.description,
          type: item.type,
          source: item.source,
          versions: item.versions,
          loaders: item.loaders,
          thumbnail: item.thumbnail,
        };

        const details = await fetchExplorerItemDetails(detailItem);
        setModInstallStage("validating");
        const preferred = findCompatibleVersion(details.versions);
        if (!preferred?.downloadUrl) {
          continue;
        }

        compatibleItems.push({
          id: item.projectId,
          name: item.name,
          version: selectedInstance.version,
          provider: item.source === "CurseForge" ? "curseforge" : "modrinth",
          type: catalogType,
          sourceLabel: item.source,
          thumbnail: item.thumbnail,
          gameVersions: preferred.gameVersions.length
            ? preferred.gameVersions
            : item.versions,
          loaders: preferred.loaders.length ? preferred.loaders : item.loaders,
          fileSizeBytes: item.fileSizeBytes,
        });
      }

      setCatalogMods(compatibleItems);
    } catch (error) {
      setCatalogError(
        error instanceof Error ? error.message : "No se pudo buscar contenido.",
      );
      setCatalogMods([]);
    } finally {
      setCatalogLoading(false);
    }
  };

  const installSelectedCatalogMods = async () => {
    if (!selectedInstance || selectedCatalogMods.length === 0) {
      return;
    }

    setInstallingMods(true);
    setModInstallStage("downloading");
    setModInstallCurrent(0);
    setModInstallTotal(selectedCatalogMods.length);
    setModInstallStartedAt(Date.now());
    setCatalogError(null);
    try {
      const queue = [...selectedCatalogMods];
      const seen = new Set(queue.map((mod) => `${mod.provider}:${mod.id}`));
      const installedEntries: CatalogMod[] = [];
      let detectedLoader: Instance["loaderName"] | null = null;

      for (let index = 0; index < queue.length; index += 1) {
        const mod = queue[index];
        const detailItem: ExplorerItem = {
          id: `${mod.provider}-${mod.id}`,
          projectId: mod.id,
          name: mod.name,
          author: mod.sourceLabel ?? mod.provider,
          downloads: "0",
          rawDownloads: 0,
          description: mod.name,
          type: mod.type,
          source: mod.provider === "curseforge" ? "CurseForge" : "Modrinth",
          versions: mod.gameVersions,
          loaders: mod.loaders,
          thumbnail: mod.thumbnail,
        };
        const details = await fetchExplorerItemDetails(detailItem);
        setModInstallStage("validating");
        const preferred = findCompatibleVersion(details.versions);

        if (!preferred?.downloadUrl) {
          throw new Error(
            `${mod.name} no tiene una versión compatible con Minecraft ${selectedInstance.version} y loader ${selectedInstance.loaderName}.`,
          );
        }

        const loaderCandidate = (preferred.loaders ?? []).find((loader) =>
          ["neoforge", "forge", "fabric", "quilt"].includes(loader.toLowerCase()),
        );
        if (loaderCandidate) {
          const normalized = loaderCandidate.toLowerCase();
          if (normalized === "neoforge") detectedLoader = "NeoForge";
          else if (normalized === "forge") detectedLoader = "Forge";
          else if (normalized === "fabric") detectedLoader = "Fabric";
          else if (normalized === "quilt") detectedLoader = "Quilt";
        }

        await installModFileToInstance(
          selectedInstance.id,
          preferred.downloadUrl,
          `${mod.name}-${preferred.id}.jar`,
        );
        setModInstallStage("installing");
        installedEntries.push(mod);
        setModInstallCurrent(installedEntries.length);

        const dependencies = preferred.dependencies ?? details.dependencies;
        for (const dependency of dependencies) {
          const key = `${mod.provider}:${dependency}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          queue.push({
            id: dependency,
            name: `Dependencia ${dependency}`,
            version: selectedInstance.version,
            provider: mod.provider,
            type: "Mods",
            sourceLabel: mod.provider === "curseforge" ? "CurseForge" : "Modrinth",
            gameVersions: [selectedInstance.version],
            loaders: [selectedInstance.loaderName.toLowerCase()],
          });
        }
      }

      const deduplicated = new Map(
        [...(installedModsByInstance[selectedInstance.id] ?? [])].map((entry) => [
          entry.id,
          entry,
        ]),
      );
      for (const mod of installedEntries) {
        const key = `${selectedInstance.id}-${mod.provider}-${mod.id}`;
        deduplicated.set(key, {
          id: key,
          name: mod.name,
          version: selectedInstance.version,
          enabled: true,
          source: mod.provider,
        });
      }
      const nextMods = Array.from(deduplicated.values());

      setInstalledModsByInstance((prev) => ({
        ...prev,
        [selectedInstance.id]: nextMods,
      }));
      onUpdateInstance(selectedInstance.id, {
        mods: nextMods.length,
        ...(selectedInstance.loaderName === "Vanilla" && detectedLoader
          ? { loaderName: detectedLoader, loaderVersion: "latest" }
          : {}),
      });
      setSelectedCatalogMods([]);
      setModReviewOpen(false);
      setModDownloadOpen(false);
      setModInstallStage("completed");
      setInstanceLaunchStatus(
        selectedInstance?.id,
        `${installedEntries.length} ${modDownloadTarget.toLowerCase()} instalados correctamente (incluyendo dependencias).`,
      );
    } catch (error) {
      setCatalogError(
        error instanceof Error
          ? error.message
          : "No se pudieron instalar los elementos seleccionados.",
      );
    } finally {
      setInstallingMods(false);
      window.setTimeout(() => setModInstallStage("idle"), 1500);
    }
  };
  const addCatalogModWithDependencies = async (mod: CatalogMod) => {
    if (!selectedInstance) {
      return;
    }
    const seed = [...selectedCatalogMods, mod];
    setDetectedDependencyCount(0);
    const queue = [mod];
    const seen = new Set(seed.map((entry) => `${entry.provider}:${entry.id}`));

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      try {
        const details = await fetchExplorerItemDetails({
          id: `${current.provider}-${current.id}`,
          projectId: current.id,
          name: current.name,
          author: current.sourceLabel ?? current.provider,
          downloads: "0",
          rawDownloads: 0,
          description: current.name,
          type: current.type,
          source: current.provider === "curseforge" ? "CurseForge" : "Modrinth",
          versions: current.gameVersions,
          loaders: current.loaders,
          thumbnail: current.thumbnail,
        });
        const preferred = findCompatibleVersion(details.versions);
        const dependencies = preferred?.dependencies ?? details.dependencies;

        for (const dependency of dependencies) {
          const key = `${current.provider}:${dependency}`;
          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          const dependencyItem: CatalogMod = {
            id: dependency,
            name: `Dependencia ${dependency}`,
            version: selectedInstance.version,
            provider: current.provider,
            type: "Mods",
            sourceLabel: current.provider === "curseforge" ? "CurseForge" : "Modrinth",
            gameVersions: [selectedInstance.version],
            loaders: [selectedInstance.loaderName.toLowerCase()],
          };
          seed.push(dependencyItem);
          setDetectedDependencyCount((prev) => prev + 1);
          queue.push(dependencyItem);
        }
      } catch {
        // Si falla el detalle de una dependencia, seguimos con el resto.
      }
    }

    setSelectedCatalogMods(seed);
  };

  useEffect(() => {
    if (!modDownloadOpen) {
      return;
    }
    void loadCatalogMods();
  }, [catalogType, modDownloadOpen, modProvider]);

  const installProgress =
    modInstallTotal > 0 ? Math.round((modInstallCurrent / modInstallTotal) * 100) : 0;
  const selectedTotalSizeBytes = selectedCatalogMods.reduce(
    (acc, current) => acc + (current.fileSizeBytes ?? 0),
    0,
  );
  const elapsedSeconds = modInstallStartedAt
    ? Math.max(1, (Date.now() - modInstallStartedAt) / 1000)
    : 1;
  const installRate =
    modInstallCurrent > 0 ? (modInstallCurrent / elapsedSeconds).toFixed(2) : "0.00";

  const renderEditorBody = () => {
    if (activeEditorSection === "Registro de Minecraft" && selectedInstance) {
      const logs = runtimeLogByInstance[selectedInstance.id] ?? [];

      return (
        <div className="instance-live-log">
          <div className="instance-live-log__toolbar">
            <strong>Registro en tiempo real</strong>
            <span>
              {selectedInstance.isRunning ? "En ejecución" : "Instancia detenida"}
            </span>
          </div>
          <div className="instance-live-log__stream" aria-live="polite">
            {logs.length ? (
              logs.map((line, index) => (
                <p
                  key={`${line}-${index}`}
                  className={`instance-import__log-line ${checklistLogLineClass(line)}`}
                >
                  {line}
                </p>
              ))
            ) : (
              <p>Sin eventos todavía.</p>
            )}
          </div>
        </div>
      );
    }

    if (activeEditorSection === "Versión") {
      return (
        <div className="instance-config__grid">
          <article className="instance-config__card">
            <h6>Versiones de la instancia</h6>
            <label>
              Versión de Minecraft
              <select
                value={selectedInstance?.version ?? instanceVersion}
                onChange={(event) =>
                  selectedInstance
                    ? onUpdateInstance(selectedInstance.id, {
                        version: event.target.value,
                      })
                    : setInstanceVersion(event.target.value)
                }
              >
                {(filteredVersions.length
                  ? filteredVersions
                  : [
                      {
                        id: selectedInstance?.version ?? instanceVersion ?? "Sin datos",
                        type: "release" as const,
                      },
                    ]
                ).map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Loader
              <select
                value={selectedInstance?.loaderName ?? instanceLoader}
                onChange={(event) =>
                  selectedInstance
                    ? onUpdateInstance(selectedInstance.id, {
                        loaderName: event.target.value,
                      })
                    : setInstanceLoader(event.target.value)
                }
              >
                <option value="Vanilla">Vanilla</option>
                <option value="NeoForge">NeoForge</option>
                <option value="Forge">Forge</option>
                <option value="Fabric">Fabric</option>
                <option value="Quilt">Quilt</option>
              </select>
            </label>
            <label>
              Versión de loader
              <select
                value={selectedInstance?.loaderVersion ?? instanceLoaderVersion}
                onChange={(event) =>
                  selectedInstance
                    ? onUpdateInstance(selectedInstance.id, {
                        loaderVersion: event.target.value,
                      })
                    : setInstanceLoaderVersion(event.target.value)
                }
              >
                {(loaderVersions.length
                  ? loaderVersions
                  : [
                      (selectedInstance?.loaderVersion ?? instanceLoaderVersion) ||
                        "latest",
                    ]
                ).map((version) => (
                  <option key={version} value={version}>
                    {version}
                  </option>
                ))}
              </select>
            </label>
          </article>
          <article className="instance-config__card">
            <h6>Resumen actual</h6>
            <ul>
              {versionRows.map((row) => (
                <li key={row.name}>
                  <strong>{row.name}:</strong> {row.version}
                </li>
              ))}
            </ul>
          </article>
        </div>
      );
    }

    if (activeEditorSection === "Mods" && selectedInstance) {
      return (
        <div className="instance-editor__table">
          <div className="instance-editor__table-header">
            <span>Estado · Mod · Versión</span>
            <span>Proveedor</span>
          </div>
          {installedMods.length === 0 ? (
            <p>No hay mods instalados en esta instancia.</p>
          ) : null}
          {installedMods.map((mod) => (
            <button
              key={mod.id}
              type="button"
              className={
                selectedModId === mod.id
                  ? "instance-editor__table-row instance-editor__table-row--selected"
                  : "instance-editor__table-row"
              }
              onClick={() => setSelectedModId(mod.id)}
            >
              <span>
                {mod.enabled ? "✔️" : "⏸️"} {mod.name} · {mod.version}
              </span>
              <span>
                {mod.source === "modrinth"
                  ? "Modrinth"
                  : mod.source === "curseforge"
                    ? "CurseForge"
                    : "Desconocido"}
              </span>
            </button>
          ))}
        </div>
      );
    }

    if (activeEditorSection === "Configuración" && selectedInstance) {
      return (
        <div className="instance-config">
          <div className="instance-config__intro">
            <h5>📦 Configuración de instancia</h5>
            <p>Este panel sobrescribe ajustes globales solo para esta instancia.</p>
            <p>Nada aquí afecta a otras instancias.</p>
            <button type="button" className="explorer-item__secondary">
              🔗 Abrir configuración global
            </button>
          </div>
          <div
            className="instance-config__tabs"
            role="tablist"
            aria-label="Pestañas de configuración"
          >
            {instanceConfigTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeConfigTab === tab}
                className={
                  activeConfigTab === tab
                    ? "instance-config__tab instance-config__tab--active"
                    : "instance-config__tab"
                }
                onClick={() => setActiveConfigTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeConfigTab === "General" ? (
            <div className="instance-config__grid">
              <article className="instance-config__card">
                <h6>🪟 Ventana del juego</h6>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedConfig.launchMaximized}
                    onChange={(event) =>
                      updateSelectedConfig("launchMaximized", event.target.checked)
                    }
                  />{" "}
                  Iniciar Minecraft maximizado
                </label>
                <label>
                  Tamaño de ventana (ancho × alto)
                  <input
                    value={selectedConfig.windowSize}
                    onChange={(event) =>
                      updateSelectedConfig("windowSize", event.target.value)
                    }
                    placeholder="1280x720"
                    disabled={selectedConfig.launchMaximized}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedConfig.hideLauncherOnGameOpen}
                    onChange={(event) =>
                      updateSelectedConfig("hideLauncherOnGameOpen", event.target.checked)
                    }
                  />{" "}
                  Ocultar Interface al abrir Minecraft
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedConfig.quitLauncherOnGameClose}
                    onChange={(event) =>
                      updateSelectedConfig(
                        "quitLauncherOnGameClose",
                        event.target.checked,
                      )
                    }
                  />{" "}
                  Cerrar Interface al salir del juego
                </label>
              </article>
              <article className="instance-config__card">
                <h6>🖥 Consola</h6>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedConfig.showConsoleOnLaunch}
                    onChange={(event) =>
                      updateSelectedConfig("showConsoleOnLaunch", event.target.checked)
                    }
                  />{" "}
                  Mostrar consola al iniciar el juego
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedConfig.showConsoleOnCrash}
                    onChange={(event) =>
                      updateSelectedConfig("showConsoleOnCrash", event.target.checked)
                    }
                  />{" "}
                  Mostrar consola si hay crash
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedConfig.hideConsoleOnQuit}
                    onChange={(event) =>
                      updateSelectedConfig("hideConsoleOnQuit", event.target.checked)
                    }
                  />{" "}
                  Ocultar consola al cerrar el juego
                </label>
              </article>
              <article className="instance-config__card">
                <h6>📁 Data packs globales</h6>
                <label>
                  Ruta de carpeta
                  <input
                    value={selectedConfig.globalDatapacksPath}
                    onChange={(event) =>
                      updateSelectedConfig("globalDatapacksPath", event.target.value)
                    }
                    placeholder="/datapacks/global"
                  />
                </label>
                <small>⚠ Requiere mods específicos · ⚠ No es vanilla-friendly</small>
              </article>
              <article className="instance-config__card">
                <h6>⏱ Tiempo de juego</h6>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedConfig.showPlaytime}
                    onChange={(event) =>
                      updateSelectedConfig("showPlaytime", event.target.checked)
                    }
                  />{" "}
                  Mostrar tiempo jugado en esta instancia
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedConfig.recordPlaytime}
                    onChange={(event) =>
                      updateSelectedConfig("recordPlaytime", event.target.checked)
                    }
                  />{" "}
                  Registrar tiempo jugado en esta instancia
                </label>
              </article>
              <article className="instance-config__card">
                <h6>👤 Cuenta por instancia</h6>
                <label>
                  Cuenta
                  <select
                    value={selectedConfig.overrideAccount}
                    onChange={(event) =>
                      updateSelectedConfig("overrideAccount", event.target.value)
                    }
                  >
                    <option>Cuenta global</option>
                    <option>ManzanitaSpace</option>
                    <option>Testing-Alt</option>
                  </select>
                </label>
              </article>
              <article className="instance-config__card">
                <h6>🔌 Enable Auto-join</h6>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedConfig.autoJoinEnabled}
                    onChange={(event) =>
                      updateSelectedConfig("autoJoinEnabled", event.target.checked)
                    }
                  />{" "}
                  Activar auto-join
                </label>
                <label>
                  Dirección del servidor
                  <input
                    value={selectedConfig.autoJoinServer}
                    onChange={(event) =>
                      updateSelectedConfig("autoJoinServer", event.target.value)
                    }
                    placeholder="play.servidor.net:25565"
                  />
                </label>
                <label>
                  Singleplayer world
                  <input
                    value={selectedConfig.autoJoinWorld}
                    onChange={(event) =>
                      updateSelectedConfig("autoJoinWorld", event.target.value)
                    }
                    placeholder="Nombre del mundo"
                  />
                </label>
              </article>
            </div>
          ) : null}

          {activeConfigTab === "Java" ? (
            <div className="instance-config__grid">
              <article className="instance-config__card">
                <h6>☕ Instalación de Java</h6>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedConfig.javaOverrideEnabled}
                    onChange={(event) =>
                      updateSelectedConfig("javaOverrideEnabled", event.target.checked)
                    }
                  />{" "}
                  Instalación de Java (override)
                </label>
                <label>
                  Java Executable
                  <input
                    value={selectedConfig.javaExecutable}
                    onChange={(event) =>
                      updateSelectedConfig("javaExecutable", event.target.value)
                    }
                    placeholder=".../java-runtime/bin/javaw.exe"
                  />
                </label>
                <div className="instance-config__inline-actions">
                  <button type="button" onClick={handleAutoTuneJava}>
                    ⚡ Auto-tune de flags
                  </button>
                  <button type="button" onClick={detectJavaFromSystem}>
                    🧭 Detectar Java automáticamente
                  </button>
                  <button type="button" onClick={browseJavaExecutable}>
                    📂 Buscar ejecutable
                  </button>
                  <button type="button" onClick={testJavaSettings}>
                    🧪 Probar configuración
                  </button>
                  <button type="button" onClick={openJavaDownloader}>
                    ⬇️ Descargar Java recomendado
                  </button>
                </div>
                <label className="instance-config__warning">
                  <input
                    type="checkbox"
                    checked={selectedConfig.skipJavaCompatibilityChecks}
                    onChange={(event) =>
                      updateSelectedConfig(
                        "skipJavaCompatibilityChecks",
                        event.target.checked,
                      )
                    }
                  />{" "}
                  Omitir las comprobaciones de compatibilidad de Java
                </label>
                {javaAdvisorNotes.length ? (
                  <ul className="instance-config__advice">
                    {javaAdvisorNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
              <article className="instance-config__card">
                <h6>🧠 Memoria</h6>
                <label>
                  Memoria mínima (Xms)
                  <input
                    type="number"
                    min={256}
                    max={16384}
                    value={selectedConfig.minMemory}
                    onChange={(event) =>
                      updateSelectedConfig("minMemory", Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  Memoria máxima (Xmx)
                  <input
                    type="number"
                    min={512}
                    max={32768}
                    value={selectedConfig.maxMemory}
                    onChange={(event) =>
                      updateSelectedConfig("maxMemory", Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  PermGen (-XX:PermSize)
                  <input
                    value={selectedConfig.permGen}
                    onChange={(event) =>
                      updateSelectedConfig("permGen", event.target.value)
                    }
                  />
                </label>
              </article>
              <article className="instance-config__card">
                <h6>🧾 Argumentos de Java</h6>
                <textarea
                  value={selectedConfig.javaArgs}
                  onChange={(event) =>
                    updateSelectedConfig("javaArgs", event.target.value)
                  }
                  rows={4}
                />
                <small>
                  Se validarán flags duplicadas de Xms/Xmx en próximas versiones.
                </small>
              </article>
            </div>
          ) : null}

          {activeConfigTab === "Ajustes" ? (
            <div className="instance-editor__form">
              <label>
                Nombre
                <input
                  value={editorName}
                  onChange={(event) => setEditorName(event.target.value)}
                />
              </label>
              <label>
                Grupo
                <input
                  value={editorGroup}
                  onChange={(event) => setEditorGroup(event.target.value)}
                />
              </label>
              <label>
                Memoria
                <input
                  value={editorMemory}
                  onChange={(event) => setEditorMemory(event.target.value)}
                  placeholder="4 GB"
                />
              </label>
              <div className="instance-editor__actions">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateInstance(selectedInstance.id, {
                      name: editorName.trim() || selectedInstance.name,
                      group: editorGroup.trim() || "No agrupado",
                      memory: editorMemory.trim() || "4 GB",
                      javaMode: selectedConfig.javaOverrideEnabled
                        ? "manual"
                        : "embedded",
                      javaPath: selectedConfig.javaOverrideEnabled
                        ? selectedConfig.javaExecutable.trim()
                        : "",
                    })
                  }
                >
                  Guardar cambios
                </button>
              </div>
            </div>
          ) : null}

          {activeConfigTab === "Comandos Personalizados" ? (
            <div className="instance-config__grid">
              <article className="instance-config__card">
                <h6>🟩 Comandos Personalizados</h6>
                <label>
                  Antes de lanzar
                  <textarea
                    rows={2}
                    value={selectedConfig.customPreLaunchCommand}
                    onChange={(event) =>
                      updateSelectedConfig("customPreLaunchCommand", event.target.value)
                    }
                  />
                </label>
                <label>
                  Después de cerrar
                  <textarea
                    rows={2}
                    value={selectedConfig.customPostExitCommand}
                    onChange={(event) =>
                      updateSelectedConfig("customPostExitCommand", event.target.value)
                    }
                  />
                </label>
                <label>
                  En crash
                  <textarea
                    rows={2}
                    value={selectedConfig.customCrashCommand}
                    onChange={(event) =>
                      updateSelectedConfig("customCrashCommand", event.target.value)
                    }
                  />
                </label>
              </article>
            </div>
          ) : null}

          {activeConfigTab === "Variables de Entorno" ? (
            <div className="instance-config__grid">
              <article className="instance-config__card">
                <h6>🟪 Variables de Entorno</h6>
                <textarea
                  rows={6}
                  value={selectedConfig.envVariables}
                  onChange={(event) =>
                    updateSelectedConfig("envVariables", event.target.value)
                  }
                />
              </article>
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="instance-editor__placeholder">
        <p>No hay datos disponibles para {activeEditorSection}.</p>
      </div>
    );
  };

  const handleExternalScan = async (mode: "quick" | "advanced" = "quick") => {
    setExternalStatus("loading");
    setExternalError(null);
    setScanCancelled(false);
    setScanStatusText("Validando");
    setScanStats(null);
    try {
      const report =
        mode === "quick"
          ? {
              mode,
              instances: await fetchExternalInstances(),
              stats: { rootsScanned: 0, rootsDetected: 0, visitedDirs: 0, elapsedMs: 0 },
            }
          : await scanExternalInstances({
              mode,
              depthLimit: scanDepthLimit,
              includeAllVolumes: scanAllVolumes,
              includeManualRoots: true,
            });
      if (scanCancelled) {
        setScanStatusText("Pendiente");
        setExternalStatus("idle");
        return;
      }
      setExternalInstances(report.instances);
      setExternalStatus("ready");
      setScanStatusText("Listo");
      setScanStats(
        `Raíces: ${report.stats.rootsScanned} · detectadas: ${report.stats.rootsDetected} · dirs: ${report.stats.visitedDirs} · ${report.stats.elapsedMs} ms`,
      );
    } catch (error) {
      setExternalInstances([]);
      setExternalStatus("error");
      setScanStatusText("Error");
      setExternalError(
        error instanceof Error
          ? error.message
          : "No se pudieron detectar instancias externas.",
      );
    }
  };

  const handleCancelScan = () => {
    setScanCancelled(true);
    setScanStatusText("Pendiente");
    setExternalStatus("idle");
  };

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setImportFileName(file ? file.name : "");
  };

  const mapLocalInstanceToUi = (imported: {
    id: string;
    name: string;
    version: string;
    loaderName?: string;
    loaderVersion?: string;
    loader_name?: string;
    loader_version?: string;
    sourceLauncher?: string;
    sourcePath?: string;
    sourceInstanceName?: string;
    javaMode?: "auto" | "embedded" | "manual";
    javaPath?: string;
  }): Instance => ({
    id: imported.id,
    name: imported.name,
    version: imported.version,
    loaderName: imported.loaderName ?? imported.loader_name ?? "vanilla",
    loaderVersion: imported.loaderVersion ?? imported.loader_version ?? "latest",
    mods: 0,
    memory: "4 GB",
    status: "ready",
    group: "No agrupado",
    lastPlayed: "Nunca",
    playtime: "0 min",
    playtimeMinutes: 0,
    isDownloading: false,
    isRunning: false,
    sourceLauncher: imported.sourceLauncher,
    sourcePath: imported.sourcePath,
    sourceInstanceName: imported.sourceInstanceName,
    javaMode: imported.javaMode,
    javaPath: imported.javaPath,
  });

  const handleImportArchive = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Modpack/Instancia", extensions: ["zip", "mrpack"] }],
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }

      const imported = await importInstance(selected);
      const newInstance = mapLocalInstanceToUi(imported);
      onCreateInstance(newInstance);
      onSelectInstance(newInstance.id);
      setImportFileName(selected.split(/[\/]/).pop() ?? "");
      setInstanceLaunchStatus(
        newInstance.id,
        `Instancia importada: ${newInstance.name}.`,
      );
      setCreatorOpen(false);
    } catch (error) {
      setInstanceLaunchStatus(
        selectedInstance?.id,
        error instanceof Error
          ? `No se pudo importar la instancia: ${error.message}`
          : "No se pudo importar la instancia.",
      );
    }
  };

  const handleImportDetectedInstance = async (external: ExternalInstance) => {
    try {
      const imported = await importExternalInstance({ externalId: external.id });
      const newInstance = mapLocalInstanceToUi(imported);
      onCreateInstance(newInstance);
      onSelectInstance(newInstance.id);
      setInstanceLaunchStatus(
        newInstance.id,
        `Instancia vinculada desde ${external.launcher}: ${newInstance.name}.`,
      );
      setCreatorOpen(false);
    } catch (error) {
      setInstanceLaunchStatus(
        selectedInstance?.id,
        error instanceof Error
          ? `No se pudo vincular la instancia externa: ${error.message}`
          : "No se pudo vincular la instancia externa.",
      );
    }
  };

  const renderCreatorBody = () => {
    if (activeCreatorSection === "Personalizado") {
      return (
        <div className="instance-creator__panel">
          <div className="instance-creator__field">
            <label htmlFor="instance-name">Nombre de la instancia</label>
            <input
              id="instance-name"
              type="text"
              placeholder="Ej: Mi mundo"
              value={instanceName}
              onChange={(event) => setInstanceName(event.target.value)}
            />
          </div>
          <div className="instance-creator__field">
            <label htmlFor="instance-group">Grupo</label>
            <input
              id="instance-group"
              type="text"
              placeholder="No agrupado"
              value={instanceGroup}
              onChange={(event) => setInstanceGroup(event.target.value)}
            />
          </div>
          <div className="instance-creator__field">
            <label htmlFor="instance-version">Versión de Minecraft</label>
            <div className="instance-creator__filters">
              <label>
                <input
                  type="checkbox"
                  checked={versionFilters.release}
                  onChange={() =>
                    setVersionFilters((prev) => ({
                      ...prev,
                      release: !prev.release,
                    }))
                  }
                />
                Versiones estables
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={versionFilters.snapshot}
                  onChange={() =>
                    setVersionFilters((prev) => ({
                      ...prev,
                      snapshot: !prev.snapshot,
                    }))
                  }
                />
                Snapshots
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={versionFilters.beta}
                  onChange={() =>
                    setVersionFilters((prev) => ({
                      ...prev,
                      beta: !prev.beta,
                    }))
                  }
                />
                Betas
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={versionFilters.alpha}
                  onChange={() =>
                    setVersionFilters((prev) => ({
                      ...prev,
                      alpha: !prev.alpha,
                    }))
                  }
                />
                Alfas
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={versionFilters.experimental}
                  onChange={() =>
                    setVersionFilters((prev) => ({
                      ...prev,
                      experimental: !prev.experimental,
                    }))
                  }
                />
                Experimentales
              </label>
            </div>
            <select
              id="instance-version"
              value={instanceVersion}
              onChange={(event) => setInstanceVersion(event.target.value)}
              disabled={versionsStatus === "loading" || versionsStatus === "error"}
            >
              {filteredVersions.length ? (
                filteredVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.id}
                    {version.type === "snapshot" ? " (snapshot)" : ""}
                  </option>
                ))
              ) : (
                <option value="">Sin versiones disponibles</option>
              )}
            </select>
          </div>
          <div className="instance-creator__field">
            <label htmlFor="instance-loader">Loader</label>
            <select
              id="instance-loader"
              value={instanceLoader}
              onChange={(event) => setInstanceLoader(event.target.value)}
            >
              <option value="Vanilla">Vanilla</option>
              <option value="NeoForge">NeoForge</option>
              <option value="Forge">Forge</option>
              <option value="Fabric">Fabric</option>
              <option value="Quilt">Quilt</option>
            </select>
          </div>
          <div className="instance-creator__field">
            <label htmlFor="instance-loader-version">Versión del loader</label>
            <select
              id="instance-loader-version"
              value={instanceLoaderVersion}
              onChange={(event) => setInstanceLoaderVersion(event.target.value)}
              disabled={instanceLoader === "Vanilla" || loaderStatus === "loading"}
            >
              {instanceLoader === "Vanilla" ? (
                <option value="">No aplica para Vanilla</option>
              ) : loaderVersions.length ? (
                loaderVersions.map((version) => (
                  <option key={version} value={version}>
                    {version}
                  </option>
                ))
              ) : loaderStatus === "error" ? (
                <option value="">Sin versiones disponibles</option>
              ) : (
                <option value="">Cargando versiones...</option>
              )}
            </select>
          </div>
          <div className="instance-creator__field">
            <label htmlFor="instance-java-mode">Java de la instancia</label>
            <select
              id="instance-java-mode"
              value={creatorJavaMode}
              onChange={(event) =>
                setCreatorJavaMode(event.target.value as "auto" | "embedded" | "manual")
              }
            >
              <option value="auto">Auto (detectar instalado)</option>
              <option value="embedded">Embebido de Interface</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div className="instance-creator__field">
            <label htmlFor="instance-java-path">Ruta Java manual</label>
            <input
              id="instance-java-path"
              value={creatorJavaPath}
              disabled={creatorJavaMode !== "manual"}
              onChange={(event) => setCreatorJavaPath(event.target.value)}
              placeholder="C:/Program Files/Java/jdk-21/bin/javaw.exe"
            />
          </div>
          <div className="instance-creator__hint">
            {versionsStatus === "loading" && "Cargando versiones oficiales..."}
            {versionsStatus === "error" &&
              (versionsError ?? "No se pudieron cargar las versiones oficiales.")}
            {loaderStatus === "error" &&
              (loaderError ?? "No se pudieron cargar las versiones del loader.")}
            {(versionsStatus === "ready" || versionsStatus === "idle") &&
              "Configura una instancia limpia y agrega recursos más tarde."}
          </div>
        </div>
      );
    }

    if (activeCreatorSection === "Importar") {
      return (
        <div className="instance-creator__panel">
          <div className="instance-import__hero">
            <img src={importGuide} alt="Guía de importación" />
            <div>
              <h5>Centro modular de importación</h5>
              <p>
                Flujo guiado: detección → validación → modo copia/enlace → adaptación
                interna → verificación final.
              </p>
            </div>
          </div>
          <div className="instance-import__tabs">
            {importTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className={
                  activeImportTab === tab
                    ? "instance-import__tab instance-import__tab--active"
                    : "instance-import__tab"
                }
                onClick={() => setActiveImportTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="instance-import__supported">
            <strong>Estado del módulo:</strong> {scanStatusText} ·{" "}
            {importFlowStates.join(" / ")}
            {scanStats ? <p>{scanStats}</p> : null}
          </div>

          {activeImportTab === "Escaneo automático" ? (
            <div className="instance-import__external">
              <div className="instance-import__header">
                <h6>Escaneo configurable</h6>
                <div className="instance-import__actions">
                  <button type="button" onClick={() => void handleExternalScan("quick")}>
                    Búsqueda rápida
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExternalScan("advanced")}
                  >
                    Búsqueda avanzada
                  </button>
                  <button type="button" onClick={handleCancelScan}>
                    Cancelar
                  </button>
                </div>
              </div>
              <div className="instance-import__controls">
                <label>
                  Profundidad
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={scanDepthLimit}
                    onChange={(event) =>
                      setScanDepthLimit(Number(event.target.value) || 4)
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={scanAllVolumes}
                    onChange={(event) => setScanAllVolumes(event.target.checked)}
                  />
                  Incluir volúmenes montados externos
                </label>
              </div>
            </div>
          ) : null}

          {activeImportTab === "Importar desde archivo (zip/mrpack/manifest)" ? (
            <div className="instance-import__row">
              <label htmlFor="import-url">Importación por archivo o enlace</label>
              <div className="instance-import__controls">
                <input
                  id="import-url"
                  type="url"
                  placeholder="https://..."
                  value={importUrl}
                  onChange={(event) => setImportUrl(event.target.value)}
                />
                <label className="instance-import__file">
                  <input
                    type="file"
                    accept=".zip,.mrpack"
                    onChange={handleImportFileChange}
                  />
                  Navegar
                </label>
                <button type="button" onClick={() => void handleImportArchive()}>
                  Importar archivo
                </button>
              </div>
              {importFileName ? (
                <span className="instance-import__filename">
                  Archivo: {importFileName}
                </span>
              ) : null}
            </div>
          ) : null}

          {activeImportTab === "Importar desde launcher detectado" ||
          activeImportTab === "Instancias enlazadas" ||
          activeImportTab === "Escaneo automático" ? (
            <div className="instance-import__external">
              {externalStatus === "loading" ? (
                <p>Escaneando launchers y estructuras válidas...</p>
              ) : null}
              {externalError ? (
                <p className="instance-import__error">{externalError}</p>
              ) : null}
              {externalInstances.length ? (
                <div className="instance-import__list">
                  {externalInstances.map((instance) => (
                    <div key={instance.signature} className="instance-import__item">
                      <div>
                        <strong>{instance.name}</strong>
                        <span>
                          {instance.launcher} · {instance.version} · {instance.loaderName}{" "}
                          {instance.loaderVersion}
                        </span>
                        <span>{instance.details ?? instance.path}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleImportDetectedInstance(instance)}
                      >
                        {activeImportTab === "Instancias enlazadas"
                          ? "Vincular"
                          : "Importar"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : externalStatus === "ready" ? (
                <p>No se encontraron instancias externas.</p>
              ) : null}
            </div>
          ) : null}

          {activeImportTab === "Importar desde carpeta personalizada" ? (
            <div className="instance-import__supported">
              <h6>Carpetas personalizadas</h6>
              <p>
                Añade rutas en Ajustes/raíces externas y vuelve a ejecutar el escaneo. Se
                validarán estructuras .minecraft, versions, libraries, mods, config y
                saves.
              </p>
            </div>
          ) : null}
        </div>
      );
    }

    if (
      activeCreatorSection === "Modrinth" ||
      activeCreatorSection === "CurseForge" ||
      activeCreatorSection === "ATLauncher"
    ) {
      return (
        <div className="instance-creator__panel">
          <div className="instance-creator__hint">
            {creatorStatus === "loading" && "Cargando modpacks..."}
            {creatorStatus === "error" &&
              (creatorError ?? "No se pudieron cargar los modpacks.")}
            {creatorStatus === "ready" && creatorItems.length === 0
              ? "No hay modpacks disponibles en esta fuente."
              : null}
          </div>
          <div className="instance-import__list">
            {creatorItems.map((item) => (
              <div key={item.id} className="instance-import__item">
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.type} · {item.source}
                  </span>
                </div>
                <div className="instance-import__actions">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      Ver
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setInstanceName(item.name);
                      setInstanceVersion(item.versions[0] ?? instanceVersion);
                      const loader = item.loaders[0]?.toLowerCase();
                      if (loader === "forge") setInstanceLoader("Forge");
                      else if (loader === "fabric") setInstanceLoader("Fabric");
                      else if (loader === "quilt") setInstanceLoader("Quilt");
                      else if (loader === "neoforge") setInstanceLoader("NeoForge");
                      else setInstanceLoader("Vanilla");
                      setActiveCreatorSection("Personalizado");
                    }}
                  >
                    Instalar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return null;
  };

  const handleContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    instance: Instance | null,
  ) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      instance,
    });
  };

  const handleCreateInstance = async () => {
    const trimmedName = instanceName.trim();
    const trimmedGroup = instanceGroup.trim();
    const resolvedVersion = instanceVersion || preferredVersion?.id || "1.21.1";
    const resolvedName =
      trimmedName.length > 0 ? trimmedName : `Nueva instancia ${resolvedVersion}`;
    const resolvedLoaderVersion =
      instanceLoader === "Vanilla" ? "latest" : instanceLoaderVersion.trim() || "latest";
    const newInstance: Instance = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `instance-${Date.now()}`,
      name: resolvedName,
      version: resolvedVersion,
      loaderName: instanceLoader,
      loaderVersion: resolvedLoaderVersion,
      mods: 0,
      memory: "4 GB",
      status: "ready",
      group: trimmedGroup.length > 0 ? trimmedGroup : "No agrupado",
      lastPlayed: "Nunca",
      playtime: "0 min",
      playtimeMinutes: 0,
      isDownloading: false,
      isRunning: false,
      downloadProgress: 0,
      downloadLabel: "Instancia creada. Pulsa Iniciar para descargar/verificar runtime.",
      javaMode: creatorJavaMode,
      javaPath: creatorJavaMode === "manual" ? creatorJavaPath.trim() : "",
    };
    onCreateInstance(newInstance);
    try {
      setInstanceLaunchStatus(newInstance.id, "Preparando archivos base de Minecraft...");
      await createInstance(newInstance);
      onUpdateInstance(newInstance.id, {
        status: "ready",
        isDownloading: false,
        downloadProgress: 100,
        downloadStage: "finalizando",
        downloadLabel: "Instancia lista para iniciar",
      });
      setInstanceLaunchStatus(
        newInstance.id,
        "Instancia creada y preparada correctamente.",
      );
    } catch (error) {
      console.error("No se pudo crear la instancia", error);
      onUpdateInstance(newInstance.id, {
        status: "stopped",
        isDownloading: false,
        downloadProgress: 0,
      });
      setInstanceLaunchStatus(
        newInstance.id,
        error instanceof Error
          ? `No se pudo crear la instancia: ${error.message}`
          : "No se pudo crear la instancia.",
      );
    }
    setInstanceName("");
    setInstanceGroup("");
    setInstanceLoaderVersion("");
    setCreatorOpen(false);
  };

  const isWorkspaceView =
    creatorOpen ||
    launchChecklistOpen ||
    (Boolean(selectedInstance) && (editorOpen || modDownloadOpen || modReviewOpen || repairModalOpen));

  const handleQuickLaunch = async (instance: Instance) => {
    if (startupProgressByInstance[instance.id]?.active || instance.isRunning) {
      onSelectInstance(instance.id);
      return;
    }
    onSelectInstance(instance.id);
    openChecklistWithContext(instance.id);
    updateStartupProgress(instance.id, {
      active: true,
      progress: 12,
      stage: "Inicio rápido",
    });
    setInstanceLaunchStatus(instance.id, `Iniciando ${instance.name}...`);
    try {
      const result = await launchInstance(instance.id);
      onUpdateInstance(instance.id, {
        isRunning: true,
        processId: result.pid,
        status: "ready",
      });
      updateStartupProgress(instance.id, {
        active: false,
        progress: 100,
        stage: "Instancia iniciada",
      });
    } catch (error) {
      updateStartupProgress(instance.id, {
        active: false,
        progress: 0,
        stage: "Error al iniciar",
      });
      setInstanceLaunchStatus(
        instance.id,
        error instanceof Error
          ? `No se pudo iniciar ${instance.name}: ${error.message}`
          : `No se pudo iniciar ${instance.name}.`,
      );
    }
  };

  return (
    <section
      className={
        isWorkspaceView
          ? "panel-view panel-view--instances panel-view--instances-workspace"
          : "panel-view panel-view--instances"
      }
      onClick={(event) => {
        if (event.target === event.currentTarget && selectedInstance) {
          onClearSelection();
        }
      }}
    >
      {!isWorkspaceView ? (
        <div className="panel-view__header">
          <div className="panel-view__actions">
            <input
              type="search"
              placeholder="Buscar instancia, grupo, versión o loader..."
              value={instanceSearch}
              onChange={(event) => setInstanceSearch(event.target.value)}
            />
            <button type="button" onClick={openCreator}>
              Crear instancia
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatorOpen(true);
                setActiveCreatorSection("Importar");
              }}
            >
              Importar
            </button>
            <button
              type="button"
              className="panel-view__focus-toggle"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setContextMenu(null);
                onToggleFocusMode();
              }}
              aria-label={isFocusMode ? "Mostrar barras" : "Ocultar barras"}
              title={isFocusMode ? "Mostrar barras" : "Ocultar barras"}
            >
              {isFocusMode ? "⤢" : "⤡"}
            </button>
          </div>
        </div>
      ) : null}
      {!creatorOpen ? (
        <div
          className={
            selectedInstance
              ? editorOpen
                ? "instances-layout instances-layout--editor"
                : "instances-layout"
              : "instances-layout instances-layout--single"
          }
        >
          <div
            className="instances-layout__grid"
            onClick={onClearSelection}
            onContextMenu={(event) => handleContextMenu(event, null)}
          >
            {groupedInstances.length === 0 && (
              <div className="instances-layout__empty">
                {instanceSearch.trim().length > 0 ? (
                  <>
                    <p>No hay resultados para "{instanceSearch}".</p>
                    <span>Prueba con nombre, grupo, versión o loader.</span>
                  </>
                ) : (
                  <>
                    <p>No hay instancias creadas todavía.</p>
                    <span>Usa "Crear instancia" para comenzar.</span>
                  </>
                )}
              </div>
            )}
            {groupedInstances.map(([groupName, groupInstances]) => (
              <section key={groupName} className="instance-group">
                <header className="instance-group__header">
                  <h3>{groupName}</h3>
                  <span>{groupInstances.length} instancias</span>
                </header>
                <div className="instance-group__grid">
                  {groupInstances.map((instance) => (
                    <article
                      key={instance.id}
                      className={
                        selectedInstanceId === instance.id
                          ? "instance-card instance-card--active"
                          : "instance-card"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectInstance(instance.id);
                      }}
                      onContextMenu={(event) => handleContextMenu(event, instance)}
                      onDoubleClick={() => {
                        void handleQuickLaunch(instance);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectInstance(instance.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="instance-card__cover">
                        <img
                          className="instance-card__cover-logo"
                          src="/tauri.svg"
                          alt="Logo del launcher"
                          loading="lazy"
                        />
                        <span>{groupName}</span>
                      </div>
                      <div className="instance-card__body">
                        <div>
                          <h3>{instance.name}</h3>
                          <p>Minecraft {instance.version}</p>
                          <p>
                            {instance.loaderName} {instance.loaderVersion}
                          </p>
                          {instance.sourceLauncher ? (
                            <p className="instance-card__source-tag">
                              Importada de {instance.sourceLauncher}
                              {instance.sourceInstanceName
                                ? ` · ${instance.sourceInstanceName}`
                                : ""}
                            </p>
                          ) : null}
                        </div>
                        <span className="instance-card__status">
                          {startupProgressByInstance[instance.id]?.active
                            ? "Inicializando"
                            : (statusLabels[instance.status] ?? "Estado desconocido")}
                        </span>
                        {startupProgressByInstance[instance.id]?.active ? (
                          <div className="instance-card__startup">
                            <div className="instance-card__startup-head">
                              <strong>
                                {startupProgressByInstance[instance.id].stage}
                              </strong>
                              <span>
                                {Math.max(
                                  0,
                                  Math.min(
                                    100,
                                    Math.round(
                                      startupProgressByInstance[instance.id].progress,
                                    ),
                                  ),
                                )}
                                %
                              </span>
                            </div>
                            <div
                              className="instance-card__startup-track"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(
                                startupProgressByInstance[instance.id].progress,
                              )}
                            >
                              <div
                                className="instance-card__startup-fill"
                                style={{
                                  width: `${Math.max(0, Math.min(100, startupProgressByInstance[instance.id].progress))}%`,
                                }}
                              />
                            </div>
                          </div>
                        ) : null}
                        <div className="instance-card__meta">
                          <span>{instance.mods} mods</span>
                          <span>{formatRelativeTime(instance.lastPlayed)}</span>
                          <span>{formatPlaytime(instance.playtime)}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {selectedInstance && !editorOpen && (
            <aside className="instance-menu" onClick={(event) => event.stopPropagation()}>
              <>
                <div className="instance-menu__header">
                  <div className="instance-menu__image" aria-hidden="true">
                    <img src="/tauri.svg" alt="Logo del launcher" loading="lazy" />
                  </div>
                  <div>
                    <span className="instance-menu__launcher">
                      {selectedInstance.sourceLauncher
                        ? `Importada · ${selectedInstance.sourceLauncher}`
                        : "Interface"}
                    </span>
                    <h3>{selectedInstance.name}</h3>
                    <p>Minecraft {selectedInstance.version}</p>
                    <span className="instance-menu__playtime">
                      Tiempo total: {formatPlaytime(selectedInstance.playtime)}
                    </span>
                  </div>
                </div>
                <div className="instance-menu__scroll">
                  <div className="instance-menu__section">
                    <p className="instance-menu__health">
                      {instanceHealth.icon} {instanceHealth.label}
                    </p>
                    {selectedLaunchStatus ? (
                      <p className="instance-menu__launch-status">
                        {selectedLaunchStatus}
                      </p>
                    ) : null}

                    <div className="instance-menu__repair-split">
                      <button
                        type="button"
                        className="instance-menu__primary-action instance-menu__primary-action--match-edit"
                        onClick={() => void primaryAction.action()}
                        disabled={primaryAction.disabled}
                      >
                        {primaryAction.label}
                      </button>
                      <button
                        type="button"
                        className="instance-menu__primary-action instance-menu__primary-action--mini"
                        onClick={() => setRepairQuickOpen((prev) => !prev)}
                        disabled={!selectedInstanceHasValidId}
                      >
                        ▼
                      </button>
                    </div>
                    {repairQuickOpen ? (
                      <div className="instance-menu__repair-quick">
                        <button
                          type="button"
                          onClick={() => void runRepairFlow("inteligente")}
                        >
                          Reparación rápida
                        </button>
                        <button
                          type="button"
                          onClick={() => void runRepairFlow("completa")}
                        >
                          Reparación profunda
                        </button>
                        <button
                          type="button"
                          onClick={() => void runRepairFlow("reinstalar_loader")}
                        >
                          Reinstalar loader
                        </button>
                        <button
                          type="button"
                          onClick={() => void runRepairFlow("reparar_y_optimizar")}
                        >
                          Limpiar caché + optimizar
                        </button>
                        <button
                          type="button"
                          onClick={() => void runRepairFlow("verificar_integridad")}
                        >
                          Verificar integridad (JSON)
                        </button>
                      </div>
                    ) : null}

                    <div className="instance-menu__section-title">Uso diario</div>
                    <div className="instance-menu__actions instance-menu__actions--grid">
                      {quickActions.frequent.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => void action.action()}
                          className="instance-menu__action-btn"
                        >
                          <span>{action.label}</span>
                        </button>
                      ))}
                    </div>

                    <div className="instance-menu__section-title">Gestión</div>
                    <div className="instance-menu__actions instance-menu__actions--grid">
                      {quickActions.management.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => void action.action()}
                          className="instance-menu__action-btn"
                        >
                          <span>{action.label}</span>
                        </button>
                      ))}
                    </div>

                    <hr className="instance-menu__danger-separator" />
                    <button
                      type="button"
                      className="instance-menu__danger"
                      onClick={() => setDeleteConfirmId(selectedInstance.id)}
                    >
                      Eliminar instancia
                    </button>
                  </div>
                </div>
              </>
            </aside>
          )}
          {repairModalOpen && selectedInstance ? (
            <section className="instance-workspace-page instance-workspace-page--repair">
              <section className="instance-repair-modal">
                <h3>Reparar Instancia</h3>
                <p>Selecciona el modo de reparación:</p>
                <div className="instance-repair-modal__modes">
                  {[
                    ["inteligente", "Reparación Inteligente (Recomendado)"],
                    ["completa", "Reparación Completa (Forzar todo)"],
                    ["solo_verificar", "Solo verificar"],
                    ["solo_mods", "Reparar solo Mods"],
                    ["reinstalar_loader", "Reinstalar Loader"],
                    ["reparar_y_optimizar", "🛡 Reparar y Optimizar"],
                    ["verificar_integridad", "🔎 Verificar integridad (limpiar JSON)"],
                  ].map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="repairMode"
                        checked={repairMode === value}
                        onChange={() => setRepairMode(value as RepairMode)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="instance-repair-modal__actions">
                  <button type="button" onClick={() => setRepairModalOpen(false)}>
                    Cancelar
                  </button>
                  <button type="button" onClick={() => void runRepairFlow(repairMode)}>
                    Ejecutar reparación
                  </button>
                </div>
              </section>
            </section>
          ) : null}
          {selectedInstance && editorOpen && (
            <section className="instance-workspace-page instance-workspace-page--editor">
              <section className="instance-editor-panel instance-editor-panel--page">
                <header className="instance-editor__header">
                  <div>
                    <h3>Editar {selectedInstance.name}</h3>
                    <p>Minecraft {selectedInstance.version}</p>
                  </div>
                  <button
                    type="button"
                    className="instance-button instance-button--ghost"
                    onClick={closeEditor}
                  >
                    Volver
                  </button>
                </header>
                <div className="instance-editor__body">
                  <aside className="instance-editor__sidebar">
                    {editorSections.map((section) => (
                      <button
                        key={section}
                        type="button"
                        onClick={() => setActiveEditorSection(section)}
                        className={
                          activeEditorSection === section
                            ? "instance-editor__tab instance-editor__tab--active"
                            : "instance-editor__tab"
                        }
                      >
                        {section}
                      </button>
                    ))}
                  </aside>
                  <div className="instance-editor__content">
                    <div className="instance-editor__heading">
                      <div>
                        <h4>{activeEditorSection}</h4>
                        <p>Gestiona esta sección con herramientas avanzadas.</p>
                      </div>
                      <input type="search" placeholder="Buscar en la sección..." />
                    </div>
                    <div className="instance-editor__workspace">
                      <div className="instance-editor__panel">{renderEditorBody()}</div>
                      <aside className="instance-editor__rail">
                        {activeEditorSection === "Mods" ? (
                          <>
                            <h5>Opciones de mods</h5>
                            <div className="instance-editor__mods-menu">
                              <button
                                type="button"
                                onClick={() => {
                                  setModDownloadTarget("Mods");
                                  setCatalogType("Mods");
                                  setModDownloadOpen(true);
                                }}
                              >
                                Descargar mods
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  window.alert(
                                    "Buscando actualizaciones para todos los mods instalados...",
                                  )
                                }
                              >
                                Buscar actualizaciones
                              </button>
                              <button
                                type="button"
                                disabled={!selectedInstalledMod}
                                onClick={() =>
                                  window.alert(
                                    "Selecciona versión del mod en su proveedor.",
                                  )
                                }
                              >
                                Cambiar versión
                              </button>
                              <label className="instance-editor__import-btn">
                                Añadir archivo
                                <input
                                  type="file"
                                  accept=".jar"
                                  style={{ display: "none" }}
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (!file || !selectedInstance) return;
                                    setInstalledModsByInstance((prev) => ({
                                      ...prev,
                                      [selectedInstance.id]: [
                                        ...(prev[selectedInstance.id] ?? []),
                                        {
                                          id: `${selectedInstance.id}-${Date.now()}`,
                                          name: file.name.replace(/\.jar$/i, ""),
                                          version: "Archivo local",
                                          enabled: true,
                                          source: "local",
                                        },
                                      ],
                                    }));
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                disabled={!selectedInstalledMod}
                                onClick={() => {
                                  if (!selectedInstance || !selectedInstalledMod) return;
                                  setInstalledModsByInstance((prev) => ({
                                    ...prev,
                                    [selectedInstance.id]: (
                                      prev[selectedInstance.id] ?? []
                                    ).filter((mod) => mod.id !== selectedInstalledMod.id),
                                  }));
                                  setSelectedModId(null);
                                }}
                              >
                                Remover
                              </button>
                              <button
                                type="button"
                                disabled={!selectedInstalledMod}
                                onClick={() => {
                                  if (!selectedInstance || !selectedInstalledMod) return;
                                  setInstalledModsByInstance((prev) => ({
                                    ...prev,
                                    [selectedInstance.id]: (
                                      prev[selectedInstance.id] ?? []
                                    ).map((mod) =>
                                      mod.id === selectedInstalledMod.id
                                        ? { ...mod, enabled: !mod.enabled }
                                        : mod,
                                    ),
                                  }));
                                }}
                              >
                                Activar / desactivar
                              </button>
                              <button
                                type="button"
                                disabled={!selectedInstalledMod}
                                onClick={() =>
                                  window.alert(
                                    `Información de ${selectedInstalledMod?.name ?? "mod"}`,
                                  )
                                }
                              >
                                Ver página de inicio
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void openInstanceSubPath(
                                    "minecraft/mods",
                                    "la carpeta de mods",
                                  );
                                }}
                              >
                                Ver carpeta
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void openInstanceSubPath(
                                    "minecraft/config",
                                    "la carpeta de configuración",
                                  );
                                }}
                              >
                                Ver configuraciones
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const rows = installedMods.map(
                                    (mod) =>
                                      `${mod.name},${mod.version},${mod.enabled ? "activo" : "desactivado"},${mod.source}`,
                                  );
                                  const csv = `nombre,version,estado,origen
${rows.join("\n")}`;
                                  const blob = new Blob([csv], {
                                    type: "text/csv;charset=utf-8;",
                                  });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = `${selectedInstance?.name ?? "instancia"}-mods.csv`;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                }}
                              >
                                Exportar lista
                              </button>
                            </div>
                          </>
                        ) : activeEditorSection === "Shader Packs" ? (
                          <>
                            <h5>Opciones de shaders</h5>
                            <div className="instance-editor__mods-menu">
                              <button
                                type="button"
                                onClick={() => {
                                  setModDownloadTarget("Shaders");
                                  setCatalogType("Shaders");
                                  setModDownloadOpen(true);
                                }}
                              >
                                Descargar shaders
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void openInstanceSubPath(
                                    "minecraft/shaderpacks",
                                    "la carpeta shaderpacks",
                                  );
                                }}
                              >
                                Ver carpeta
                              </button>
                            </div>
                          </>
                        ) : activeEditorSection === "Resource Packs" ? (
                          <>
                            <h5>Opciones de resource packs</h5>
                            <div className="instance-editor__mods-menu">
                              <button
                                type="button"
                                onClick={() => {
                                  setModDownloadTarget("Resource Packs");
                                  setCatalogType("Resource Packs");
                                  setModDownloadOpen(true);
                                }}
                              >
                                Descargar resource packs
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void openInstanceSubPath(
                                    "minecraft/resourcepacks",
                                    "la carpeta resourcepacks",
                                  );
                                }}
                              >
                                Ver carpeta
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <h5>Información</h5>
                            <p className="instance-editor__status-note">
                              Selecciona la sección <strong>Mods</strong>,{" "}
                              <strong>Shader Packs</strong> o{" "}
                              <strong>Resource Packs</strong> para gestionar descargas.
                            </p>
                          </>
                        )}
                      </aside>
                    </div>
                  </div>
                </div>
              </section>
            </section>
          )}
        </div>
      ) : null}

      {contextMenu && (
        <div
          className="instance-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.instance ? (
            <>
              <span className="instance-context-menu__title">
                {contextMenu.instance.name}
              </span>
              <button type="button" onClick={openEditor}>
                Editar
              </button>
              <button type="button" onClick={openCreator}>
                Crear otra instancia
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveEditorSection("Mods");
                  openEditor();
                }}
              >
                Atajo: Gestionar mods
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveEditorSection("Registro de Minecraft");
                  openEditor();
                }}
              >
                Atajo: Ver logs en vivo
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirmId(contextMenu.instance?.id ?? null)}
              >
                Eliminar instancia
              </button>
            </>
          ) : (
            <>
              <span className="instance-context-menu__title">Opciones del panel</span>
              <button type="button" onClick={openCreator}>
                Crear instancia
              </button>
              <button
                type="button"
                onClick={() => void createDesktopShortcutForSelected()}
              >
                Atajo en escritorio
              </button>
            </>
          )}
        </div>
      )}
      {deleteConfirmId && (
        <div
          className="instance-editor__backdrop"
          onClick={() => setDeleteConfirmId(null)}
        >
          <article
            className="product-dialog product-dialog--install"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h3>Confirmación</h3>
            </header>
            <div className="product-dialog__install-body">
              <p>¿Deseas eliminar esta instancia?</p>
              <div className="instance-import__actions">
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      try {
                        await removeInstance(deleteConfirmId);
                        onDeleteInstance(deleteConfirmId);
                        setInstanceLaunchStatus(
                          selectedInstance?.id,
                          "Instancia eliminada correctamente.",
                        );
                      } catch (error) {
                        setInstanceLaunchStatus(
                          selectedInstance?.id,
                          error instanceof Error
                            ? `No se pudo eliminar la instancia: ${error.message}`
                            : "No se pudo eliminar la instancia.",
                        );
                      } finally {
                        setDeleteConfirmId(null);
                      }
                    })();
                  }}
                >
                  Aceptar
                </button>
                <button type="button" onClick={() => setDeleteConfirmId(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          </article>
        </div>
      )}

      {launchChecklistOpen ? (
        <section className="instance-workspace-page instance-workspace-page--checklist">
          <article className="product-dialog product-dialog--install product-dialog--checklist product-dialog--checklist-page">
            <header>
              <h3>Checklist de inicio de instancia</h3>
              <div className="product-dialog__checklist-actions">
                <button
                  type="button"
                  onClick={() => {
                    launchChecklistCancelledRef.current = true;
                    launchChecklistRunRef.current = 0;
                    setLaunchChecklistRunning(false);
                    setLaunchChecklistSummary("⚠ Preparación cancelada por el usuario.");
                    setLaunchChecklistLogs((prev) => [
                      ...prev,
                      "⚠ Preparación cancelada manualmente.",
                    ]);
                    if (activeChecklistInstanceId) {
                      updateStartupProgress(activeChecklistInstanceId, {
                        active: false,
                        stage: "Preparación cancelada",
                      });
                    }
                    setLaunchChecklistOpen(false);
                    setActiveChecklistInstanceId(null);
                  }}
                  disabled={!launchChecklistRunning}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLaunchChecklistOpen(false);
                    setActiveChecklistInstanceId(null);
                  }}
                >
                  Seguir esperando
                </button>
              </div>
            </header>
            <div className="product-dialog__install-body product-dialog__checklist-body">
              <div className="product-dialog__checklist-intro">
                <p>
                  Verificando punto por punto antes de abrir Minecraft. La validación
                  revisa runtime, assets, librerías y configuración de inicio. Si tarda
                  más de lo esperado puedes seguir esperando o cancelar manualmente.
                </p>
                <span
                  className={`product-dialog__checklist-badge ${
                    launchChecklistRunning
                      ? "is-running"
                      : launchChecklistSummary?.includes("✅")
                        ? "is-success"
                        : "is-idle"
                  }`}
                >
                  {launchChecklistRunning
                    ? "Validación en curso"
                    : (launchChecklistSummary ?? "Esperando ejecución")}
                </span>
              </div>

              {activeChecklistInstanceId &&
              startupProgressByInstance[activeChecklistInstanceId] ? (
                <div className="product-dialog__checklist-progress">
                  <div className="product-dialog__checklist-progress-head">
                    <strong>
                      {startupProgressByInstance[activeChecklistInstanceId].stage}
                    </strong>
                    <span>
                      {Math.max(
                        0,
                        Math.min(
                          100,
                          Math.round(
                            startupProgressByInstance[activeChecklistInstanceId].progress,
                          ),
                        ),
                      )}
                      %
                    </span>
                  </div>
                  <div
                    className="product-dialog__checklist-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(
                      startupProgressByInstance[activeChecklistInstanceId].progress,
                    )}
                  >
                    <div
                      className="product-dialog__checklist-progress-fill"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(
                            100,
                            startupProgressByInstance[activeChecklistInstanceId].progress,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                  {startupProgressByInstance[activeChecklistInstanceId].details ? (
                    <small>
                      {startupProgressByInstance[activeChecklistInstanceId].details}
                    </small>
                  ) : null}
                  {formatEta(
                    startupProgressByInstance[activeChecklistInstanceId].etaSeconds,
                  ) ? (
                    <small>
                      Tiempo estimado restante:{" "}
                      {formatEta(
                        startupProgressByInstance[activeChecklistInstanceId].etaSeconds,
                      )}
                    </small>
                  ) : null}
                </div>
              ) : null}

              <div className="product-dialog__checklist-panels">
                <section className="product-dialog__checklist-panel">
                  <h4>Resultados técnicos</h4>
                  {launchChecklistChecks.length > 0 ? (
                    <ul className="product-dialog__checklist-results">
                      {launchChecklistChecks.map((check) => (
                        <li key={check.name} className={check.ok ? "is-ok" : "is-error"}>
                          <span>{check.ok ? "✅" : "❌"}</span>
                          <span>{check.name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="product-dialog__checklist-empty">
                      Los resultados aparecerán en cuanto termine el primer análisis.
                    </p>
                  )}
                </section>

                <section className="product-dialog__checklist-panel">
                  <h4>Bitácora en vivo</h4>
                  <div
                    className="instance-import__log"
                    aria-live="polite"
                    ref={checklistLogContainerRef}
                  >
                    {launchChecklistLogs.map((line, index) => (
                      <p
                        key={`${line}-${index}`}
                        className={`instance-import__log-line ${checklistLogLineClass(line)}`}
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="product-dialog__checklist-copy"
                    onClick={async () => {
                      const content = launchChecklistLogs.join("\n");
                      if (!content.trim()) {
                        return;
                      }
                      try {
                        await navigator.clipboard.writeText(content);
                        setLaunchChecklistLogs((prev) => [
                          ...prev,
                          "📋 Bitácora copiada al portapapeles.",
                        ]);
                      } catch {
                        setLaunchChecklistLogs((prev) => [
                          ...prev,
                          "⚠ No se pudo copiar la bitácora automáticamente en este entorno.",
                        ]);
                      }
                    }}
                  >
                    Copiar bitácora
                  </button>
                </section>

                <section className="product-dialog__checklist-panel">
                  <h4>Debug backend (tiempo real)</h4>
                  <p className="product-dialog__checklist-empty">
                    Incluye estado crudo, comando de Java y rutas de logs para soporte
                    técnico.
                  </p>
                  {launchChecklistDebugState ? (
                    <div className="instance-import__log" aria-live="polite">
                      <p>
                        <strong>Estado:</strong>{" "}
                        {launchChecklistDebugState.status ?? "sin estado"}
                      </p>
                      {launchChecklistDebugState.command ? (
                        <p>
                          <strong>Comando:</strong> {launchChecklistDebugState.command}
                        </p>
                      ) : null}
                      {launchChecklistDebugState.stdoutPath ? (
                        <p>
                          <strong>STDOUT:</strong> {launchChecklistDebugState.stdoutPath}
                        </p>
                      ) : null}
                      {launchChecklistDebugState.stderrPath ? (
                        <p>
                          <strong>STDERR:</strong> {launchChecklistDebugState.stderrPath}
                        </p>
                      ) : null}
                      {launchChecklistDebugState.details ? (
                        <pre>
                          {JSON.stringify(launchChecklistDebugState.details, null, 2)}
                        </pre>
                      ) : (
                        <p>Sin detalles adicionales reportados por backend.</p>
                      )}
                    </div>
                  ) : (
                    <p className="product-dialog__checklist-empty">
                      El estado detallado del backend aparecerá durante la validación.
                    </p>
                  )}
                </section>
              </div>
            </div>
          </article>
        </section>
      ) : null}

      {modDownloadOpen && selectedInstance ? (
        <section className="instance-workspace-page instance-workspace-page--download">
          <article className="product-dialog product-dialog--install product-dialog--download">
            <header>
              <h3>Descargador e instalador de {modDownloadTarget}</h3>
              <button type="button" onClick={() => setModDownloadOpen(false)}>
                Volver
              </button>
            </header>
            <div className="product-dialog__install-body">
              <p>
                Flujo compatible con {selectedInstance.loaderName} · Minecraft{" "}
                {selectedInstance.version}.
              </p>
              <div
                className="instance-download__pipeline"
                aria-label="Pipeline de instalación"
              >
                {[
                  ["downloading", "Descargando"],
                  ["validating", "Validando"],
                  ["installing", "Instalando"],
                  ["completed", "Finalizado"],
                ].map(([stage, label]) => (
                  <span
                    key={stage}
                    className={
                      modInstallStage === stage
                        ? "is-active"
                        : modInstallStage === "completed"
                          ? "is-done"
                          : ""
                    }
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="instance-download__metrics">
                <p>
                  <strong>Progreso global:</strong> {installProgress}% (
                  {modInstallCurrent}/{modInstallTotal || selectedCatalogMods.length || 0}
                  )
                </p>
                <p>
                  <strong>Velocidad:</strong> {installRate} mods/s
                </p>
                <p>
                  <strong>Tamaño estimado:</strong>{" "}
                  {(selectedTotalSizeBytes / (1024 * 1024)).toFixed(2)} MB
                </p>
                <p>
                  <strong>Dependencias detectadas:</strong> {detectedDependencyCount}
                </p>
              </div>
              <div className="instance-catalog__filters">
                <select
                  value={catalogType}
                  onChange={(event) =>
                    setCatalogType(
                      event.target.value as "Mods" | "Shaders" | "Resource Packs",
                    )
                  }
                >
                  <option value="Mods">Mods</option>
                  <option value="Shaders">Shaders</option>
                  <option value="Resource Packs">Resource Packs</option>
                </select>
                <button type="button" onClick={() => setModProvider("curseforge")}>
                  CurseForge
                </button>
                <button type="button" onClick={() => setModProvider("modrinth")}>
                  Modrinth
                </button>
                <input
                  value={modQuery}
                  onChange={(event) => setModQuery(event.target.value)}
                  placeholder={`Buscar ${modDownloadTarget.toLowerCase()} por nombre...`}
                />
                <button
                  type="button"
                  onClick={() => void loadCatalogMods()}
                  disabled={catalogLoading}
                >
                  Buscar
                </button>
              </div>
              {catalogError ? <p>{catalogError}</p> : null}
              {catalogLoading ? <p>Buscando contenido compatible...</p> : null}
              <div className="instance-catalog__results">
                {catalogMods.map((mod) => {
                  const alreadySelected = selectedCatalogMods.some(
                    (item) => item.id === mod.id && item.provider === mod.provider,
                  );

                  return (
                    <div
                      key={`${mod.provider}-${mod.id}`}
                      className="instance-editor__table-row"
                    >
                      <span>
                        {mod.thumbnail ? (
                          <img
                            src={mod.thumbnail}
                            alt={mod.name}
                            width={40}
                            height={40}
                            style={{
                              borderRadius: 8,
                              marginRight: 8,
                              verticalAlign: "middle",
                            }}
                          />
                        ) : null}
                        {mod.name}
                        <br />
                        <small className="instance-catalog__meta">
                          {mod.type} · {mod.sourceLabel ?? mod.provider} · MC{" "}
                          {mod.gameVersions[0] ?? selectedInstance.version} ·{" "}
                          {mod.loaders[0] ?? selectedInstance.loaderName}
                        </small>
                      </span>
                      <button
                        type="button"
                        disabled={alreadySelected}
                        onClick={() => void addCatalogModWithDependencies(mod)}
                      >
                        {alreadySelected ? "Seleccionado" : "Agregar"}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="instance-import__actions">
                <button
                  type="button"
                  disabled={!selectedCatalogMods.length}
                  onClick={() => setModReviewOpen(true)}
                >
                  Revisar y continuar
                </button>
                <button type="button" onClick={() => setModDownloadOpen(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </article>
        </section>
      ) : null}

      {modReviewOpen && selectedInstance ? (
        <section className="instance-workspace-page instance-workspace-page--review">
          <article className="product-dialog product-dialog--install">
            <header>
              <h3>Revisar mods seleccionados</h3>
            </header>
            <div className="product-dialog__install-body">
              <ul>
                {selectedCatalogMods.map((mod) => (
                  <li key={`${mod.provider}-${mod.id}`}>
                    {mod.name} · {mod.type} · {mod.provider}
                  </li>
                ))}
              </ul>
              <div className="instance-import__actions">
                <button
                  type="button"
                  onClick={() => void installSelectedCatalogMods()}
                  disabled={installingMods}
                >
                  {installingMods ? "Instalando..." : "OK / Instalar"}
                </button>
                <button type="button" onClick={() => setModReviewOpen(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </article>
        </section>
      ) : null}

      {creatorOpen ? (
        <section className="instance-creator instance-creator--inline">
          <header className="instance-creator__header">
            <div>
              <p className="instance-creator__breadcrumb">
                Mis modpacks / Crear instancia
              </p>
              <h3>Nueva instancia</h3>
              <p>Elige el origen y configura tu perfil.</p>
            </div>
            <button
              type="button"
              className="instance-button instance-button--ghost"
              onClick={() => setCreatorOpen(false)}
            >
              Volver al listado
            </button>
          </header>
          <div className="instance-creator__body">
            <aside className="instance-creator__sidebar">
              {creatorSections.map((section) => (
                <button
                  key={section}
                  type="button"
                  onClick={() => setActiveCreatorSection(section)}
                  className={
                    activeCreatorSection === section
                      ? "instance-creator__tab instance-creator__tab--active"
                      : "instance-creator__tab"
                  }
                >
                  {section}
                </button>
              ))}
            </aside>
            <div className="instance-creator__content">
              <div className="instance-creator__heading">
                <div>
                  <h4>{activeCreatorSection}</h4>
                  <p>Configura o importa tu nueva instancia.</p>
                </div>
                <input type="search" placeholder="Buscar..." />
              </div>
              <div className="instance-creator__workspace">
                {renderCreatorBody()}
                <aside className="instance-creator__rail">
                  <h5>Acciones</h5>
                  <div className="instance-creator__actions">
                    <button
                      type="button"
                      onClick={handleCreateInstance}
                      className="instance-button instance-button--primary"
                      disabled={versionsStatus === "error"}
                    >
                      Crear instancia
                    </button>
                    <button
                      type="button"
                      className="instance-button instance-button--ghost"
                      onClick={() => setCreatorOpen(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
};
