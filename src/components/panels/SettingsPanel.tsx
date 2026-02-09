import { useEffect, useState } from "react";

import { useBaseDir } from "../../hooks/useBaseDir";
import { useI18n } from "../../i18n/useI18n";
import { loadConfig, saveConfig } from "../../services/configService";
import { SelectFolderButton } from "../SelectFolderButton";

export const SettingsPanel = () => {
  const { baseDir, status } = useBaseDir();
  const { t } = useI18n();
  const [telemetryOptIn, setTelemetryOptIn] = useState(false);

  useEffect(() => {
    const load = async () => {
      const config = await loadConfig();
      setTelemetryOptIn(Boolean(config.telemetryOptIn));
    };
    void load();
  }, []);

  const toggleTelemetry = async () => {
    const config = await loadConfig();
    const nextValue = !telemetryOptIn;
    setTelemetryOptIn(nextValue);
    await saveConfig({ ...config, telemetryOptIn: nextValue });
  };

  return (
    <section className="panel-view panel-view--settings">
      <div className="panel-view__header">
        <div>
          <h2>{t("baseDir").title}</h2>
          <p>{t("baseDir").placeholder}</p>
        </div>
      </div>
      <div className="panel-view__body">
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
            checked={telemetryOptIn}
            onChange={toggleTelemetry}
          />
          Activar telemetría opcional
        </label>
      </div>
    </section>
  );
};
