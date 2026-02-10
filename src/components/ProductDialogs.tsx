import { useMemo, useState } from "react";

import type { ExplorerItem, ExplorerItemDetails } from "../services/explorerService";

interface ProductDetailsDialogProps {
  item: ExplorerItem;
  details: ExplorerItemDetails | null;
  loading: boolean;
  onClose: () => void;
  onInstall: (item: ExplorerItem) => void;
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
  const pseudoBytes = Math.max(18 * 1024 * 1024, Math.round(Math.log10(downloads + 10) * 120 * 1024 * 1024));
  return `${(pseudoBytes / 1024 / 1024).toFixed(0)} MB aprox.`;
};

export const ProductDetailsDialog = ({
  item,
  details,
  loading,
  onClose,
  onInstall,
}: ProductDetailsDialogProps) => {
  const [tab, setTab] = useState<DetailTab>("descripcion");

  const changelog = useMemo(() => {
    if (!details?.body) return [];
    return details.body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-") || line.startsWith("*") || line.startsWith("##"))
      .slice(0, 16);
  }, [details?.body]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <article className="product-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="product-dialog__top">
          <div className="product-dialog__hero-card">
            {item.thumbnail ? <img src={item.thumbnail} alt={item.name} /> : <div className="product-dialog__placeholder" />}
            <div className="product-dialog__hero-info">
              <h3>{item.name}</h3>
              <p>{item.description}</p>
              <dl>
                <div><dt>Autor</dt><dd>{item.author || details?.author || "Desconocido"}</dd></div>
                <div><dt>Tamaño</dt><dd>{bytesEstimate(details?.downloads ?? item.rawDownloads)}</dd></div>
                <div><dt>Actualizado</dt><dd>{formatDate(item.updatedAt ?? details?.updatedAt)}</dd></div>
                <div><dt>Loader/Fork</dt><dd>{(details?.loaders ?? item.loaders).slice(0, 3).join(", ") || "Vanilla"}</dd></div>
                <div><dt>Minecraft</dt><dd>{(details?.gameVersions ?? item.versions).slice(0, 5).join(", ") || "Sin datos"}</dd></div>
              </dl>
            </div>
            <div className="product-dialog__hero-actions">
              <button type="button" onClick={() => onInstall(item)}>Instalar</button>
              <button type="button" className="product-dialog__close" onClick={onClose}>✕</button>
            </div>
          </div>
        </header>

        <nav className="product-dialog__tabs">
          <button type="button" className={tab === "descripcion" ? "is-active" : ""} onClick={() => setTab("descripcion")}>Descripción</button>
          <button type="button" className={tab === "novedades" ? "is-active" : ""} onClick={() => setTab("novedades")}>Novedades</button>
          <button type="button" className={tab === "galeria" ? "is-active" : ""} onClick={() => setTab("galeria")}>Galería</button>
          <button type="button" className={tab === "versiones" ? "is-active" : ""} onClick={() => setTab("versiones")}>Versiones</button>
        </nav>

        <div className="product-dialog__content">
          {loading || !details ? <p>Cargando información completa...</p> : null}
          {!loading && details && tab === "descripcion" ? <p>{details.body ?? details.description}</p> : null}
          {!loading && details && tab === "novedades" ? (
            changelog.length ? <ul>{changelog.map((line) => <li key={line}>{line}</li>)}</ul> : <p>No se detectaron notas de cambios públicas.</p>
          ) : null}
          {!loading && details && tab === "galeria" ? (
            details.gallery.length ? (
              <div className="product-dialog__gallery-grid">
                {details.gallery.slice(0, 12).map((image) => <img key={image} src={image} alt={details.title} />)}
              </div>
            ) : <p>Sin galería disponible.</p>
          ) : null}
          {!loading && details && tab === "versiones" ? (
            <div className="product-dialog__versions">
              <div>
                <h4>Versiones Minecraft</h4>
                <ul>{details.gameVersions.slice(0, 24).map((version) => <li key={version}>{version}</li>)}</ul>
              </div>
              <div>
                <h4>Dependencias</h4>
                <ul>{details.dependencies.length ? details.dependencies.slice(0, 24).map((dependency) => <li key={dependency}>{dependency}</li>) : <li>Sin dependencias obligatorias</li>}</ul>
              </div>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
};

interface ProductInstallDialogProps {
  item: ExplorerItem;
  onClose: () => void;
}

export const ProductInstallDialog = ({ item, onClose }: ProductInstallDialogProps) => {
  const isModpackInstall = item.type.toLowerCase().includes("modpack");

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <article className="product-dialog product-dialog--install" onClick={(event) => event.stopPropagation()}>
        <header>
          <h3>Instalación</h3>
          <button type="button" className="product-dialog__close" onClick={onClose}>✕</button>
        </header>
        <div className="product-dialog__install-body">
          <p><strong>Producto:</strong> {item.name}</p>
          <p><strong>Tipo:</strong> {item.type}</p>
          <p><strong>Origen:</strong> {item.source}</p>
          <div className="instance-import__actions">
            <button type="button">Crear nueva instancia</button>
            {!isModpackInstall ? <button type="button">Instalar en instancia existente</button> : null}
          </div>
          {isModpackInstall ? <small>Los modpacks se instalan en una instancia nueva para mantener compatibilidad.</small> : <small>Puedes elegir una instancia compatible con loader y versión detectados.</small>}
        </div>
      </article>
    </div>
  );
};
