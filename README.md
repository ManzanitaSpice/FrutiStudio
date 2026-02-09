# FrutiStudio

FrutiStudio es una app de escritorio construida con Tauri, React y TypeScript
para gestionar instancias, modpacks, mods y versiones con una UX moderna y
extensible.

## Resumen técnico

- Se reorganizó la obtención de instancias con fixtures y un servicio dedicado,
  junto con un contexto UI global (zoom, sección activa, modo foco, tema).
- Se añadieron feature flags, lazy loading de paneles, error boundaries, sistema
  de notificaciones, y un panel de configuración para la carpeta base y la
  telemetría opcional.
- Se implementaron utilidades compartidas (formatters, retry, semver, i18n),
  junto con caching, rate limiting y modo offline para clientes de APIs.
- El backend en Tauri incorpora migraciones de config, dry-run de validación,
  verificación de espacio libre, logs con rotación, y comandos para gestionar
  modpacks/instancias usando SQLite.

## Comandos útiles

- `npm run dev` inicia Vite para desarrollo.
- `npm run build` compila el frontend.
- `npm run lint` corre ESLint.
- `npm run format` aplica Prettier.
- `npm run typecheck` ejecuta TypeScript sin emitir.
- `npm test` corre Vitest.

## Arquitectura

Consulta `docs/architecture.md` para la descripción de servicios, contextos y
comandos Tauri.
