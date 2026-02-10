export interface JvmTuningInput {
  javaVersion: number;
  totalSystemRamMb: number;
  modsCount: number;
  isClient: boolean;
  loaderName?: string;
}

export interface JvmPreset {
  id: "safe" | "balanced" | "modded" | "legacy";
  label: string;
  description: string;
  javaArgs: string[];
}

export interface JvmTuningRecommendation {
  minMemoryMb: number;
  maxMemoryMb: number;
  javaArgs: string[];
  preset: JvmPreset;
  notes: string[];
}

const MB_PER_GB = 1024;

const toMb = (valueGb: number) => valueGb * MB_PER_GB;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const JVM_PRESETS: JvmPreset[] = [
  {
    id: "safe",
    label: "Seguro (vanilla / pocos mods)",
    description:
      "Cliente con pocos mods. Deja que Java gestione la mayor parte de la ergonomía.",
    javaArgs: ["-XX:+ParallelRefProcEnabled", "-XX:MaxGCPauseMillis=200"],
  },
  {
    id: "balanced",
    label: "Balanceado (modpack medio)",
    description: "Ajustes conservadores para packs medianos sin castigar el sistema.",
    javaArgs: [
      "-XX:+ParallelRefProcEnabled",
      "-XX:MaxGCPauseMillis=180",
      "-XX:+UseStringDeduplication",
    ],
  },
  {
    id: "modded",
    label: "Modded pesado",
    description:
      "Para instancias con alta carga de mods, manteniendo límites para no colapsar el PC.",
    javaArgs: [
      "-XX:+ParallelRefProcEnabled",
      "-XX:MaxGCPauseMillis=160",
      "-XX:+UseStringDeduplication",
      "-XX:+AlwaysPreTouch",
    ],
  },
  {
    id: "legacy",
    label: "Legacy Java 8-16",
    description: "Compatibilidad para runtimes antiguos con G1GC explícito.",
    javaArgs: [
      "-XX:+UseG1GC",
      "-XX:+ParallelRefProcEnabled",
      "-XX:MaxGCPauseMillis=200",
      "-XX:+UnlockExperimentalVMOptions",
    ],
  },
];

const choosePreset = (javaVersion: number, modsCount: number): JvmPreset => {
  if (javaVersion < 17) {
    return JVM_PRESETS.find((preset) => preset.id === "legacy")!;
  }

  if (modsCount >= 180) {
    return JVM_PRESETS.find((preset) => preset.id === "modded")!;
  }

  if (modsCount >= 70) {
    return JVM_PRESETS.find((preset) => preset.id === "balanced")!;
  }

  return JVM_PRESETS.find((preset) => preset.id === "safe")!;
};

const estimateMemoryTarget = (modsCount: number) => {
  if (modsCount >= 250) return toMb(10);
  if (modsCount >= 180) return toMb(8);
  if (modsCount >= 120) return toMb(6);
  if (modsCount >= 60) return toMb(4);
  return toMb(3);
};

const isHeavyLoader = (loaderName?: string) => {
  const normalized = (loaderName ?? "").toLowerCase();
  return normalized.includes("forge") || normalized.includes("neoforge");
};

export const buildJvmRecommendation = ({
  javaVersion,
  totalSystemRamMb,
  modsCount,
  isClient,
  loaderName,
}: JvmTuningInput): JvmTuningRecommendation => {
  const normalizedTotalRam = clamp(totalSystemRamMb || toMb(8), toMb(4), toMb(128));
  const reserveForSystemMb = Math.max(toMb(2), Math.round(normalizedTotalRam * 0.35));
  const maxBudgetByReserve = Math.max(toMb(2), normalizedTotalRam - reserveForSystemMb);
  const maxBudgetByRatio = Math.round(normalizedTotalRam * 0.6);
  const hardCap = Math.min(maxBudgetByReserve, maxBudgetByRatio, toMb(16));
  const loaderPenalty = isHeavyLoader(loaderName) ? toMb(1) : 0;
  const desired = estimateMemoryTarget(modsCount) + loaderPenalty;

  const maxMemoryMb = clamp(desired, toMb(2), hardCap);

  const minRatio = modsCount >= 150 ? 0.5 : 0.35;
  const minMemoryMb = clamp(
    Math.round(maxMemoryMb * minRatio),
    toMb(1),
    maxMemoryMb - 256,
  );

  const selectedPreset = choosePreset(javaVersion, modsCount);
  const notes: string[] = [
    `RAM detectada: ${Math.round(normalizedTotalRam / MB_PER_GB)} GB.`,
    `Reserva automática para SO y procesos en segundo plano: ${Math.round(reserveForSystemMb / MB_PER_GB)} GB.`,
  ];

  if (isClient && javaVersion >= 17) {
    notes.push(
      "Java 17+ ya aplica ergonomía moderna de GC: se usan flags mínimas y seguras.",
    );
  }

  if (modsCount >= 150) {
    notes.push(
      "Modpack pesado detectado: se elevó Xms para evitar picos de stutter por reasignación de heap.",
    );
  }

  if (isHeavyLoader(loaderName)) {
    notes.push(
      "Loader tipo Forge/NeoForge detectado: se añadió margen adicional de memoria para arranque de mods.",
    );
  }

  if (hardCap <= toMb(3)) {
    notes.push(
      "Equipo con RAM limitada: se aplicó límite estricto en Xmx para no saturar el sistema.",
    );
  }

  return {
    minMemoryMb,
    maxMemoryMb,
    javaArgs: selectedPreset.javaArgs,
    preset: selectedPreset,
    notes,
  };
};
