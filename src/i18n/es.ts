export const esMessages = {
  appTitle: "FrutiStudio",
  sections: {
    modpacks: "Mis modpacks",
    news: "Novedades",
    explorer: "Explorador",
    servers: "Servers",
    settings: "Configuración",
  },
  emptyState: {
    title: "Sin instancias seleccionadas",
    description: "Selecciona un modpack para ver sus detalles.",
  },
  baseDir: {
    title: "Carpeta base",
    placeholder: "Selecciona la carpeta base de FrutiStudio",
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
