import { useBaseDir } from "../hooks/useBaseDir";
import { useI18n } from "../i18n/useI18n";

interface StatusBarProps {
  selectedInstance: {
    name: string;
    status: string;
    playtime: string;
  } | null;
}

export const StatusBar = ({ selectedInstance }: StatusBarProps) => {
  const { baseDir, status } = useBaseDir();
  const { t } = useI18n();

  const statusMessage =
    status === "valid"
      ? t("baseDir").statusValid
      : status === "validating"
        ? t("baseDir").statusLoading
        : status === "invalid"
          ? t("baseDir").statusInvalid
          : t("baseDir").statusIdle;

  return (
    <footer className="status-bar">
      <div className="status-bar__section">
        <strong>Estado</strong>
        <span>{statusMessage}</span>
        {baseDir && <span className="status-bar__path">📁 {baseDir}</span>}
      </div>
      <div className="status-bar__section">
        <strong>Descargas</strong>
        <span>2 activas · 8 completadas</span>
        <span className="status-bar__muted">Última sincronización: hace 3 min</span>
      </div>
      <div className="status-bar__section">
        <strong>Instancias</strong>
        <span>RAM 6.2 GB · TPS 19.8</span>
        <span className="status-bar__muted">GPU 62% · CPU 48%</span>
      </div>
      <div className="status-bar__section">
        <strong>Estado global</strong>
        <span>Todo listo para ejecutar instancias.</span>
        {selectedInstance ? (
          <span className="status-bar__highlight">
            ⏱ {selectedInstance.name}: {selectedInstance.playtime}
          </span>
        ) : (
          <span className="status-bar__muted">
            Selecciona una instancia para ver el tiempo de juego.
          </span>
        )}
      </div>
    </footer>
  );
};
