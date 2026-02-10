import {
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { Instance } from "../../types/models";
import {
  type MinecraftVersion,
  fetchMinecraftVersions,
} from "../../services/minecraftVersionService";
import { createInstance, launchInstance } from "../../services/instanceService";
import {
  type ExternalInstance,
  fetchExternalInstances,
} from "../../services/externalInstanceService";
import { fetchATLauncherPacks } from "../../services/atmlService";
import { type ExplorerItem, fetchUnifiedCatalog } from "../../services/explorerService";
import { fetchLoaderVersions } from "../../services/loaderVersionService";
import { formatPlaytime, formatRelativeTime } from "../../utils/formatters";
import importGuide from "../../assets/import-guide.svg";

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
  "Registro de Minecraft",
  "Versión",
  "Mods",
  "Resource Packs",
  "Shader Packs",
  "Notas",
  "Mundos",
  "Servidores",
  "Capturas de pantalla",
  "Configuración",
  "Otros registros",
];

const creatorSections = [
  "Personalizado",
  "Importar",
  "ATLauncher",
  "CurseForge",
  "Modrinth",
];

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
  const [instanceGroup, setInstanceGroup] = useState("");
  const [instanceVersion, setInstanceVersion] = useState("");
  const [instanceLoader, setInstanceLoader] = useState("Vanilla");
  const [instanceLoaderVersion, setInstanceLoaderVersion] = useState("");
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
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [editorName, setEditorName] = useState("");
  const [editorGroup, setEditorGroup] = useState("");
  const [editorMemory, setEditorMemory] = useState("4 GB");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    instance: Instance | null;
  } | null>(null);
  const selectedInstance =
    instances.find((instance) => instance.id === selectedInstanceId) ?? null;
  const statusLabels: Record<Instance["status"], string> = {
    ready: "Listo para jugar",
    "pending-update": "Actualización pendiente",
    stopped: "Detenida",
  };

  const versionRows = [
    { name: "Minecraft", version: selectedInstance?.version ?? "—" },
    {
      name: selectedInstance?.loaderName ?? "Loader",
      version: selectedInstance?.loaderVersion ?? "—",
    },
  ];

  const groupedInstances = useMemo(() => {
    const groupMap = new Map<string, Instance[]>();
    instances.forEach((instance) => {
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
  }, [instances]);

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

  const quickActions = useMemo(() => {
    if (!selectedInstance) {
      return [];
    }
    const hasPid = typeof selectedInstance.processId === "number";
    return [
      {
        id: "launch",
        label: "Iniciar",
        disabled: selectedInstance.isRunning,
        action: async () => {
          try {
            setLaunchStatus("Iniciando Minecraft...");
            const result = await launchInstance(selectedInstance.id);
            onUpdateInstance(selectedInstance.id, {
              isRunning: true,
              processId: result.pid,
              status: "ready",
              isDownloading: false,
              downloadProgress: 100,
              downloadStage: "finalizando",
              lastPlayed: new Date().toISOString(),
            });
            setLaunchStatus("Instancia iniciada correctamente.");
          } catch (error) {
            const message = error instanceof Error ? error.message : "No se pudo iniciar la instancia.";
            setLaunchStatus(message);
          }
        },
      },
      {
        id: "stop",
        label: "Detener",
        disabled: !selectedInstance.isRunning || !hasPid,
        action: () =>
          onUpdateInstance(selectedInstance.id, {
            isRunning: false,
            processId: undefined,
            status: "stopped",
          }),
      },
      {
        id: "edit",
        label: "Editar",
        disabled: selectedInstance.isRunning,
        action: openEditor,
      },
      {
        id: "group",
        label: "Cambiar grupo",
        disabled: false,
        action: () =>
          onUpdateInstance(selectedInstance.id, {
            group: selectedInstance.group === "No agrupado" ? "Favoritos" : "No agrupado",
          }),
      },
      {
        id: "folder",
        label: "Carpeta",
        disabled: false,
        action: () => window.alert(`Abrir carpeta de ${selectedInstance.name}`),
      },
      {
        id: "export",
        label: "Exportar",
        disabled: false,
        action: () =>
          window.alert(`Exportar ${selectedInstance.name} (mods/config/manifest.json)`),
      },
      {
        id: "copy",
        label: "Duplicar",
        disabled: false,
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
        id: "delete",
        label: "Eliminar",
        disabled: false,
        action: () => setDeleteConfirmId(selectedInstance.id),
      },
      {
        id: "shortcut",
        label: "Crear atajo",
        disabled: false,
        action: () => window.alert(`Crear atajo con --instanceId=${selectedInstance.id}`),
      },
    ];
  }, [onCreateInstance, onUpdateInstance, selectedInstance]);

  const handleCreatorBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      setCreatorOpen(false);
    }
  };

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
        let keepLoading = true;

        while (keepLoading) {
          const pageResult = await fetchUnifiedCatalog({
            category: "Modpacks",
            platform: targetPlatform,
            sort: "popular",
            page,
            pageSize: 24,
          });
          aggregated.push(...pageResult.items);
          keepLoading = pageResult.hasMore;
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

  const renderEditorBody = () => {
    if (activeEditorSection === "Versión") {
      return (
        <div className="instance-editor__table">
          <div className="instance-editor__table-header">
            <span>Nombre</span>
            <span>Versión</span>
          </div>
          {versionRows.map((row) => (
            <div key={row.name} className="instance-editor__table-row">
              <span>{row.name}</span>
              <span>{row.version}</span>
            </div>
          ))}
        </div>
      );
    }

    if (activeEditorSection === "Configuración" && selectedInstance) {
      return (
        <div className="instance-editor__form">
          <label>
            Nombre
            <input value={editorName} onChange={(event) => setEditorName(event.target.value)} />
          </label>
          <label>
            Grupo
            <input value={editorGroup} onChange={(event) => setEditorGroup(event.target.value)} />
          </label>
          <label>
            Memoria
            <input value={editorMemory} onChange={(event) => setEditorMemory(event.target.value)} placeholder="4 GB" />
          </label>
          <div className="instance-editor__actions">
            <button
              type="button"
              onClick={() =>
                onUpdateInstance(selectedInstance.id, {
                  name: editorName.trim() || selectedInstance.name,
                  group: editorGroup.trim() || "No agrupado",
                  memory: editorMemory.trim() || "4 GB",
                })
              }
            >
              Guardar cambios
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="instance-editor__placeholder">
        <p>No hay datos disponibles para {activeEditorSection}.</p>
      </div>
    );
  };

  const handleExternalScan = async () => {
    setExternalStatus("loading");
    setExternalError(null);
    try {
      const results = await fetchExternalInstances();
      setExternalInstances(results);
      setExternalStatus("ready");
    } catch (error) {
      setExternalInstances([]);
      setExternalStatus("error");
      setExternalError(
        error instanceof Error
          ? error.message
          : "No se pudieron detectar instancias externas.",
      );
    }
  };

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setImportFileName(file ? file.name : "");
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
                Releases
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
                Alphas
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
              <h5>Importar instancias y modpacks</h5>
              <p>
                Usa un link directo o selecciona un archivo local compatible con
                CurseForge, Modrinth, Prism o Technic.
              </p>
            </div>
          </div>
          <div className="instance-import__row">
            <label htmlFor="import-url">Archivo local o enlace directo</label>
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
            </div>
            {importFileName ? (
              <span className="instance-import__filename">Archivo: {importFileName}</span>
            ) : null}
          </div>
          <div className="instance-import__supported">
            <h6>Formatos soportados</h6>
            <ul>
              <li>Modpacks de CurseForge (ZIP / curseforge:// URL).</li>
              <li>Modpacks de Modrinth (ZIP y mrpack).</li>
              <li>Instancias exportadas de Prism, PolyMC o MultiMC (ZIP).</li>
              <li>Modpacks de Technic (ZIP).</li>
            </ul>
          </div>
          <div className="instance-import__external">
            <div className="instance-import__header">
              <h6>Instancias detectadas en otros launchers</h6>
              <button type="button" onClick={handleExternalScan}>
                Buscar instancias
              </button>
            </div>
            {externalStatus === "loading" ? (
              <p>Buscando instancias en Prism, CurseForge y otros launchers...</p>
            ) : null}
            {externalError ? (
              <p className="instance-import__error">{externalError}</p>
            ) : null}
            {externalInstances.length ? (
              <div className="instance-import__list">
                {externalInstances.map((instance) => (
                  <div key={instance.id} className="instance-import__item">
                    <div>
                      <strong>{instance.name}</strong>
                      <span>
                        {instance.launcher} · {instance.version}
                      </span>
                    </div>
                    <button type="button">Importar</button>
                  </div>
                ))}
              </div>
            ) : externalStatus === "ready" ? (
              <p>No se encontraron instancias externas.</p>
            ) : null}
          </div>
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
                  <button type="button">Instalar</button>
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
      instanceLoader === "Vanilla" ? "—" : instanceLoaderVersion.trim() || "latest";
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
      status: "pending-update",
      group: trimmedGroup.length > 0 ? trimmedGroup : "No agrupado",
      lastPlayed: "Nunca",
      playtime: "0 min",
      playtimeMinutes: 0,
      isDownloading: true,
      isRunning: false,
      downloadProgress: 5,
      downloadStage: "descargando",
      downloadLabel:
        instanceLoader === "Vanilla"
          ? `Descargando Minecraft ${resolvedVersion}`
          : `Descargando Minecraft ${resolvedVersion} + ${instanceLoader} ${resolvedLoaderVersion}`,
    };
    onCreateInstance(newInstance);
    try {
      await createInstance(newInstance);
    } catch (error) {
      console.error("No se pudo crear la instancia", error);
    }
    setInstanceName("");
    setInstanceGroup("");
    setInstanceLoaderVersion("");
    setCreatorOpen(false);
  };

  return (
    <section
      className="panel-view panel-view--instances"
      onClick={(event) => {
        if (event.target === event.currentTarget && selectedInstance) {
          onClearSelection();
        }
      }}
    >
      <div className="panel-view__header">
        <div className="panel-view__actions">
          <input type="search" placeholder="Buscar instancia..." />
          <button type="button" onClick={openCreator}>
            Crear instancia
          </button>
          <button type="button">Importar</button>
          <button
            type="button"
            className="panel-view__focus-toggle"
            onClick={onToggleFocusMode}
            aria-label={isFocusMode ? "Mostrar barras" : "Ocultar barras"}
            title={isFocusMode ? "Mostrar barras" : "Ocultar barras"}
          >
            {isFocusMode ? "⤢" : "⤡"}
          </button>
        </div>
      </div>
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
              <p>No hay instancias creadas todavía.</p>
              <span>Usa "Crear instancia" para comenzar.</span>
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
                      <span>{groupName}</span>
                    </div>
                    <div className="instance-card__body">
                      <div>
                        <h3>{instance.name}</h3>
                        <p>Minecraft {instance.version}</p>
                        <p>
                          {instance.loaderName} {instance.loaderVersion}
                        </p>
                      </div>
                      <span className="instance-card__status">
                        {statusLabels[instance.status] ?? "Estado desconocido"}
                      </span>
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
                <div className="instance-menu__image" />
                <div>
                  <span className="instance-menu__launcher">FrutiLauncher</span>
                  <h3>{selectedInstance.name}</h3>
                  <p>Minecraft {selectedInstance.version}</p>
                  <span className="instance-menu__playtime">
                    Tiempo total: {formatPlaytime(selectedInstance.playtime)}
                  </span>
                </div>
              </div>
              <div className="instance-menu__scroll">
                <div className="instance-menu__section">
                  <h4>Acciones rápidas</h4>
                  {launchStatus ? <p className="instance-menu__launch-status">{launchStatus}</p> : null}
                  <div className="instance-menu__actions instance-menu__actions--grid">
                    {quickActions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => void action.action()}
                        disabled={action.disabled}
                        className="instance-menu__action-btn"
                      >
                        <span className="instance-menu__action-icon" aria-hidden="true">•</span>
                        <span>{action.label}</span>
                      </button>
                    ))}
                    <button type="button" onClick={openCreator}>
                      ➕ Crear nueva
                    </button>
                  </div>
                </div>
              </div>
            </>
          </aside>
        )}
        {selectedInstance && editorOpen && (
          <div className="instance-editor__backdrop" onClick={closeEditor}>
            <section
              className="instance-editor-panel"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="instance-editor__header">
                <div>
                  <h3>Editar {selectedInstance.name}</h3>
                  <p>Minecraft {selectedInstance.version}</p>
                </div>
                <button type="button" onClick={closeEditor}>
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
                      <h5>Estado</h5>
                      <p className="instance-editor__status-note">
                        Esta sección muestra información real de la instancia
                        seleccionada.
                      </p>
                    </aside>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
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
                    onDeleteInstance(deleteConfirmId);
                    setDeleteConfirmId(null);
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

      {creatorOpen && (
        <div className="instance-editor__backdrop" onClick={handleCreatorBackdropClick}>
          <div className="instance-creator">
            <header className="instance-creator__header">
              <div>
                <h3>Nueva instancia</h3>
                <p>Elige el origen y configura tu perfil.</p>
              </div>
              <button type="button" onClick={() => setCreatorOpen(false)}>
                Cerrar
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
                        disabled={versionsStatus === "error"}
                      >
                        Crear instancia
                      </button>
                      <button type="button" onClick={() => setCreatorOpen(false)}>
                        Cerrar
                      </button>
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
