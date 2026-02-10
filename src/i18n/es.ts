export const esMessages = {
  appTitle: "Fruti Launcher",
  sections: {
    modpacks: "Mis modpacks",
    features: "Features",
    community: "Comunidad",
    explorer: "Explorador",
    servers: "Servidores",
    settings: "Configuración",
  },
  emptyState: {
    title: "Sin instancias seleccionadas",
    description: "Selecciona un modpack para ver sus detalles.",
  },
  baseDir: {
    title: "Carpeta base",
    placeholder: "Selecciona la carpeta base de Fruti Launcher",
    statusIdle: "Esperando selección de carpeta base.",
    statusLoading: "Validando carpeta base…",
    statusValid: "Carpeta base válida.",
    statusInvalid: "No se pudo validar la carpeta base.",
    action: "Elegir carpeta",
  },
  focusMode: {
    enable: "Activar modo foco",
    disable: "Desactivar modo foco",
  },
};

export type Messages = typeof esMessages;
