import { useMemo, useState } from "react";

import type {
  ExplorerItem,
  ExplorerItemDetails,
  ExplorerItemFileVersion,
} from "../services/explorerService";

interface ProductDetailsDialogProps {
  item: ExplorerItem;
  details: ExplorerItemDetails | null;
  loading: boolean;
  onClose: () => void;
  onInstall: (item: ExplorerItem, version?: ExplorerItemFileVersion) => void;
}

type DetailTab = "descripcion" | "novedades" | "galeria" | "versiones";

const formatDate = (value?: string) => {
  if (!value) return "Sin datos";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin datos";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(date);
};

const bytesEstimate = (downloads: number) => {
  if (!downloads || Number.isNaN(downloads)) return "N/D";
  const pseudoBytes = Math.max(
    18 * 1024 * 1024,
    Math.round(Math.log10(downloads + 10) * 120 * 1024 * 1024),
  );
  return `${(pseudoBytes / 1024 / 1024).toFixed(0)} MB aprox.`;
};

const formatLoader = (loader?: string) => {
  if (!loader) return "Sin datos";
  if (loader.toLowerCase() === "neoforge") return "NeoForge";
  return loader.charAt(0).toUpperCase() + loader.slice(1);
};

const releaseLabel = {
  alpha: "Alpha",
  beta: "Beta",
  release: "Release",
} as const;

export const ProductDetailsDialog = ({
  item,
  details,
  loading,
  onClose,
  onInstall,
}: ProductDetailsDialogProps) => {
  const [tab, setTab] = useState<DetailTab>("descripcion");

  const changelogRows = useMemo(() => {
    const source = details?.changelog ?? details?.body ?? "";
    return source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 40);
  }, [details?.body, details?.changelog]);

  const versions = details?.versions ?? [];

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <article className="product-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="product-dialog__top">
          <div className="product-dialog__hero-card">
            {item.thumbnail ? (
              <img src={item.thumbnail} alt={item.name} />
            ) : (
              <div className="product-dialog__placeholder" />
            )}
            <div className="product-dialog__hero-info">
              <h3>{item.name}</h3>
              <p>{details?.description ?? item.description}</p>
              <dl>
                <div>
                  <dt>Autor</dt>
                  <dd>{item.author || details?.author || "Desconocido"}</dd>
                </div>
                <div>
                  <dt>Tamaño</dt>
                  <dd>{bytesEstimate(details?.downloads ?? item.rawDownloads)}</dd>
                </div>
                <div>
                  <dt>Actualizado</dt>
                  <dd>{formatDate(item.updatedAt ?? details?.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Modloader</dt>
                  <dd>{formatLoader(details?.primaryLoader ?? details?.loaders[0])}</dd>
                </div>
                <div>
                  <dt>Versión modloader</dt>
                  <dd>{details?.primaryLoaderVersion ?? "Sin datos"}</dd>
                </div>
                <div>
                  <dt>Minecraft compatible</dt>
                  <dd>
                    {details?.primaryMinecraftVersion ??
                      details?.gameVersions?.[0] ??
                      item.versions?.[0] ??
                      "Sin datos"}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="product-dialog__hero-actions">
              <button type="button" onClick={() => onInstall(item)}>
                Instalar
              </button>
              <button
                type="button"
                className="product-dialog__close"
                onClick={onClose}
              >
                ✕
              </button>
            </div>
          </div>
        </header>

        <nav className="product-dialog__tabs">
          <button
            type="button"
            className={tab === "descripcion" ? "is-active" : ""}
            onClick={() => setTab("descripcion")}
          >
            Descripción
          </button>
          <button
            type="button"
            className={tab === "novedades" ? "is-active" : ""}
            onClick={() => setTab("novedades")}
          >
            Novedades
          </button>
          <button
            type="button"
            className={tab === "galeria" ? "is-active" : ""}
            onClick={() => setTab("galeria")}
          >
            Galería
          </button>
          <button
            type="button"
            className={tab === "versiones" ? "is-active" : ""}
            onClick={() => setTab("versiones")}
          >
            Versiones
          </button>
        </nav>

        <div className="product-dialog__content">
          {loading || !details ? <p>Cargando información completa...</p> : null}
          {!loading && details && tab === "descripcion" ? (
            <div className="product-dialog__text-block">
              {(details.body ?? details.description)
                .split("\n")
                .filter(Boolean)
                .map((line, index) => (
                  <p key={`${line}-${index}`}>{line}</p>
                ))}
            </div>
          ) : null}
          {!loading && details && tab === "novedades" ? (
            changelogRows.length ? (
              <ul className="product-dialog__changelog-list">
                {changelogRows.map((line, index) => (
                  <li key={`${line}-${index}`}>{line}</li>
                ))}
              </ul>
            ) : (
              <p>No se detectaron notas de cambios públicas.</p>
            )
          ) : null}
          {!loading && details && tab === "galeria" ? (
            details.gallery.length ? (
              <div className="product-dialog__gallery-grid">
                {details.gallery.slice(0, 12).map((image) => (
                  <img key={image} src={image} alt={details.title} />
                ))}
              </div>
            ) : (
              <p>Sin galería disponible.</p>
            )
          ) : null}
          {!loading && details && tab === "versiones" ? (
            <div className="product-dialog__versions-list">
              {versions.length ? (
                versions.map((version) => (
                  <article key={version.id} className="product-dialog__version-item">
                    <div>
                      <strong>{version.name}</strong>
                      <p>
                        {releaseLabel[version.releaseType]} · {formatDate(version.publishedAt)}
                      </p>
                      <p>
                        {formatLoader(version.loaders[0])}
                        {version.loaderVersion ? ` ${version.loaderVersion}` : ""} · Minecraft{" "}
                        {version.gameVersions[0] ?? "Sin datos"}
                      </p>
                    </div>
                    <button type="button" onClick={() => onInstall(item, version)}>
                      Instalar
                    </button>
                  </article>
                ))
              ) : (
                <p>No hay versiones disponibles en este momento.</p>
              )}
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
};

interface ProductInstallDialogProps {
  item: ExplorerItem;
  version?: ExplorerItemFileVersion;
  onClose: () => void;
}

export const ProductInstallDialog = ({
  item,
  version,
  onClose,
}: ProductInstallDialogProps) => {
  const isModpackInstall = item.type.toLowerCase().includes("modpack");

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <article
        className="product-dialog product-dialog--install"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3>Instalación</h3>
          <button type="button" className="product-dialog__close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="product-dialog__install-body">
          <p>
            <strong>Producto:</strong> {item.name}
          </p>
          <p>
            <strong>Versión:</strong> {version?.name ?? "Última estable"}
          </p>
          <p>
            <strong>Tipo:</strong> {item.type}
          </p>
          <p>
            <strong>Origen:</strong> {item.source}
          </p>
          <div className="instance-import__actions">
            <button type="button">Crear una nueva instancia</button>
            {!isModpackInstall ? (
              <button type="button">Instalar en instancia existente</button>
            ) : null}
          </div>
          {isModpackInstall ? (
            <small>
              Los modpacks se instalan en una instancia nueva para mantener compatibilidad.
            </small>
          ) : (
            <small>
              Elige una instancia compatible con loader y versión detectados para instalar.
            </small>
          )}
        </div>
      </article>
    </div>
  );
};
