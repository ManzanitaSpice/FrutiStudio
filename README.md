# FrutiStudio

FrutiStudio es una app de escritorio construida con Tauri, React y TypeScript
para gestionar instancias, modpacks, mods y versiones con una UX moderna y
extensible.

## Resumen técnico

- Moderniza el flujo de selección de carpeta en Tauri, centralizando la carpeta
  base en un contexto global (BaseDirProvider). Esto evita pasar props
  repetidamente y permite que cualquier componente acceda a la carpeta base sin
  acoplamiento, además de preparar la app para la gestión escalable de
  instancias, modpacks, mods y versiones al estilo
  MultiMC/CurseForge/Prism.
- Actualiza `select_folder` en Tauri (`lib.rs`) a async usando
  `tokio::sync::oneshot`, evitando bloquear el hilo principal y mejorando la
  interoperabilidad con React.
- Añade `BaseDirContext` y el hook `useBaseDir`, junto con `SelectFolderButton`,
  centralizando la selección y visualización de la carpeta base.
- Reescribe `App.tsx` y `App.css` para usar el nuevo contexto, con layout limpio
  y estilos consistentes que mejoran la UX inicial.
- Crea scaffolding para futuras funciones:
  - Servicios: `tauri.ts`, `instanceService.ts`, `modpackService.ts`,
    `modService.ts`, `versionService.ts`, `javaConfig.ts`.
  - Contextos: `instanceContext.tsx`, `modpackContext.tsx`, `modContext.tsx`.
  - Utilidades: `apiClients.ts`, `instanceHelpers.ts`, `modpackHelpers.ts`.

## Pruebas

El scaffolding de servicios y contextos aún no cuenta con pruebas unitarias, pero
está preparado para agregarlas en futuras integraciones.
