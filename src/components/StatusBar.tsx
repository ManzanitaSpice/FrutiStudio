import { useMemo, useState } from "react";

import type { Instance } from "../types/models";
import { formatPlaytime, formatPlaytimeMinutes } from "../utils/formatters";

interface StatusBarProps {
  selectedInstance: Instance | null;
  instances: Instance[];
}

export const StatusBar = ({ selectedInstance, instances }: StatusBarProps) => {
  const [newsOpen, setNewsOpen] = useState(false);
  const totalPlaytime = useMemo(() => {
    const totalMinutes = instances.reduce(
      (sum, instance) => sum + instance.playtimeMinutes,
      0,
    );
    return formatPlaytimeMinutes(totalMinutes);
  }, [instances]);

  const showDownloads = Boolean(selectedInstance?.isDownloading);
  const showResources = Boolean(selectedInstance?.isRunning);

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
              <p>No hay novedades publicadas en este momento.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
