import { useEffect, useMemo, useState } from "react";

import type { Instance } from "../types/models";
import { formatPlaytime, formatPlaytimeMinutes } from "../utils/formatters";
import {
  downloadUpdate,
  getStoredUpdateHistory,
  getUpdateStatus,
  type DownloadProgress,
  type UpdateHistoryEntry,
  type UpdateStatus,
} from "../services/updateService";

interface StatusBarProps {
  selectedInstance: Instance | null;
  instances: Instance[];
}

export const StatusBar = ({ selectedInstance, instances }: StatusBarProps) => {
  const [newsOpen, setNewsOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [history, setHistory] = useState<UpdateHistoryEntry[]>(() =>
    getStoredUpdateHistory(),
  );
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const totalPlaytime = useMemo(() => {
    const totalMinutes = instances.reduce(
      (sum, instance) => sum + instance.playtimeMinutes,
      0,
    );
    return formatPlaytimeMinutes(totalMinutes);
  }, [instances]);

  const showDownloads = Boolean(selectedInstance?.isDownloading);
  const showResources = Boolean(selectedInstance?.isRunning);

  useEffect(() => {
    let isActive = true;
    const run = async () => {
      setChecking(true);
      setCheckError(null);
      try {
        const status = await getUpdateStatus();
        if (isActive) {
          setUpdateStatus(status);
          setHistory(status.history);
        }
      } catch (error) {
        if (isActive) {
          setCheckError(
            error instanceof Error
              ? error.message
              : "No se pudo comprobar la actualización.",
          );
        }
      } finally {
        if (isActive) {
          setChecking(false);
        }
      }
    };
    void run();
    return () => {
      isActive = false;
    };
  }, []);

  const handleCheckUpdates = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const status = await getUpdateStatus();
      setUpdateStatus(status);
      setHistory(status.history);
    } catch (error) {
      setCheckError(
        error instanceof Error
          ? error.message
          : "No se pudo comprobar la actualización.",
      );
    } finally {
      setChecking(false);
    }
  };

  const handleDownload = async () => {
    if (!updateStatus?.latest) {
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    setDownloadProgress(null);
    try {
      await downloadUpdate(updateStatus.latest, (progress) => {
        setDownloadProgress(progress);
      });
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "No se pudo descargar la actualización.",
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <footer className="status-bar status-bar--instances">
        <div className="status-bar__main">
          {showDownloads && selectedInstance && (
            <div className="status-bar__section">
              <strong>Descargar</strong>
              <span>{selectedInstance.downloadLabel ?? "Descargando..."}</span>
              <span className="status-bar__muted">
                {selectedInstance.name}
              </span>
            </div>
          )}
          {showResources && selectedInstance?.resources && (
            <div className="status-bar__section">
              <strong>Recursos</strong>
              <span>
                RAM {selectedInstance.resources.ramMin} ·{" "}
                {selectedInstance.resources.ramMax}
              </span>
              <span className="status-bar__muted">
                GPU {selectedInstance.resources.gpu} · CPU{" "}
                {selectedInstance.resources.cpu}
              </span>
            </div>
          )}
          <div className="status-bar__section">
            <strong>Estado global</strong>
            <span>Launcher listo para ejecutar instancias.</span>
          </div>
          <div className="status-bar__section">
            <strong>Tiempo jugado</strong>
            {selectedInstance ? (
              <span className="status-bar__highlight">
                {selectedInstance.name}:{" "}
                {formatPlaytime(selectedInstance.playtime)}
              </span>
            ) : (
              <span className="status-bar__muted">
                Selecciona una instancia para ver el tiempo de juego.
              </span>
            )}
          </div>
        </div>
        <div className="status-bar__aside">
          <button
            type="button"
            className="status-bar__news"
            onClick={() => setNewsOpen(true)}
          >
            Novedades
          </button>
          <div className="status-bar__total">
            Tiempo total: {totalPlaytime}
          </div>
        </div>
      </footer>
      {newsOpen && (
        <div
          className="status-bar__news-backdrop"
          onClick={() => setNewsOpen(false)}
        >
          <div
            className="status-bar__news-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h3>Novedades del launcher</h3>
                <p>Actualizaciones y cambios recientes.</p>
              </div>
              <button type="button" onClick={() => setNewsOpen(false)}>
                Cerrar
              </button>
            </header>
            <div className="status-bar__news-body">
              <div className="status-bar__news-section">
                <div className="status-bar__news-row">
                  <div>
                    <strong>Versión instalada</strong>
                    <p>{updateStatus?.localVersion ?? "—"}</p>
                  </div>
                  <div>
                    <strong>Última comprobación</strong>
                    <p>
                      {updateStatus?.lastCheckedAt
                        ? new Date(updateStatus.lastCheckedAt).toLocaleString()
                        : "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCheckUpdates}
                    disabled={checking}
                  >
                    {checking ? "Buscando..." : "Actualizar"}
                  </button>
                </div>
                {checkError ? (
                  <p className="status-bar__news-error">{checkError}</p>
                ) : null}
              </div>

              {updateStatus?.latest ? (
                <div className="status-bar__news-section">
                  <div className="status-bar__news-row">
                    <div>
                      <strong>Última versión</strong>
                      <p>
                        v{updateStatus.latest.version} ·{" "}
                        {updateStatus.latest.date}
                      </p>
                    </div>
                    <div>
                      <strong>Estado</strong>
                      <p>
                        {updateStatus.updateAvailable
                          ? "Actualización disponible"
                          : "Al día"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownload}
                      disabled={!updateStatus.updateAvailable || downloading}
                    >
                      {downloading
                        ? "Descargando..."
                        : "Descargar actualización"}
                    </button>
                  </div>
                  <ul>
                    {updateStatus.latest.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                  {updateStatus.latest.sha256 ? (
                    <p className="status-bar__news-hint">
                      SHA256: {updateStatus.latest.sha256}
                    </p>
                  ) : null}
                  {downloadProgress ? (
                    <p className="status-bar__news-hint">
                      Descargado{" "}
                      {downloadProgress.percent
                        ? `${downloadProgress.percent}%`
                        : `${Math.round(downloadProgress.loaded / 1024)} KB`}
                    </p>
                  ) : null}
                  {downloadError ? (
                    <p className="status-bar__news-error">{downloadError}</p>
                  ) : null}
                </div>
              ) : (
                <p>No hay novedades publicadas en este momento.</p>
              )}

              {history.length ? (
                <div className="status-bar__news-section">
                  <strong>Historial de versiones</strong>
                  <div className="status-bar__news-history">
                    {history.map((entry) => (
                      <div key={entry.version} className="status-bar__news-card">
                        <div>
                          <strong>v{entry.version}</strong>
                          <span>{entry.date}</span>
                        </div>
                        <ul>
                          {entry.notes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
