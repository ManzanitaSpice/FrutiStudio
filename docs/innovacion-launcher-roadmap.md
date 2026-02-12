# Roadmap de innovación: integración incremental sin romper el launcher

Este documento aterriza 8 ideas de diferenciación (diagnóstico inteligente, sincronización cliente/servidor, nube, compatibilidad predictiva, sandbox, benchmark, editor visual y optimizador automático) sobre la base **real** que ya existe en Fruti Launcher.

## Objetivo

- Integrar capacidades avanzadas de forma progresiva.
- Reutilizar módulos actuales para minimizar riesgo.
- Activar nuevas funciones detrás de flags y rollout gradual.

## Lo que ya tenemos y cómo aprovecharlo

### Base técnica reutilizable

- **Backend Rust con pipeline y validaciones** (`core/launch_pipeline.rs`, `core/validator/`, `core/version_resolver/`, `core/modloader_resolver/`, `core/instance_runner/`).
- **Motor de reparación existente** (`core/repair/repair_manager.rs` + reparadores por dominio).
- **Descargas con cola y verificación** (`src/services/downloadQueue.ts`, `src-tauri/src/core/downloader/mod.rs`, `core/asset_downloader.rs`).
- **Capas de servicios y clientes API** (`src/services/*`, `src/services/apiClients/*`).
- **Feature flags frontend** (`src/config/featureFlags.ts`) para activación segura.

### Principio de no-ruptura

1. Mantener comandos actuales y extenderlos (no reemplazarlos de golpe).
2. Introducir almacenamiento nuevo como opcional (tablas/JSON adicionales, no migraciones destructivas).
3. Implementar fallback explícito: si falla una función avanzada, volver al flujo actual.
4. Exponer primero como `experimental` y telemetría opcional.

## Plan por iniciativa

## 1) AI Repair Engine (diagnóstico automático real)

### Estado actual

Ya existe un modo `Inteligente` en `repair_manager`, pero usa heurísticas por texto y reparación por bloques.

### Mejora incremental

- Añadir un módulo `core/repair/crash_diagnostics.rs` con:
  - parser de `latest.log` y `crash-reports/*.txt`
  - reglas estructuradas (`signature -> cause -> fix`)
  - extracción de mod sospechoso, dependencia faltante, conflicto loader/version.
- Crear un comando Tauri nuevo:
  - `diagnose_instance_crash(instance_id) -> DiagnosticReport`
- Conectar con acciones 1-click:
  - `update_dependency`
  - `disable_mod`
  - `reinstall_loader`
  - `repair_libraries`

### Riesgo y mitigación

- Riesgo: falsos positivos.
- Mitigación: devolver `confidence` y siempre mostrar “ver detalles técnicos”.

## 2) Conversión cliente ↔ servidor automática

### Estado actual

Hay servicios de servidores (`localServerService`, `remoteServerService`, `serverService`) e importación/exploración de instancias externas.

### Mejora incremental

- Nuevo servicio frontend: `serverMirrorService.ts`
- Backend:
  - `scan_server_folder(path)` para detectar loader, versión, mods y configs.
  - `build_client_mirror(manifest)` para crear perfil cliente espejo.
- Soportar sincronización bidireccional por manifiesto:
  - `server_manifest.json` con hashes.

### Fase segura

- Fase 1 solo “Servidor -> Cliente”.
- Fase 2 habilitar “Cliente -> Servidor” con validaciones extra.

## 3) Perfiles en la nube con hashes (sin subir pesado)

### Estado actual

Ya existe exportación (`modpackExportService`) y capa de clientes HTTP reusable.

### Mejora incremental

- Definir `cloud_profile_manifest.json`:
  - metadata de instancia
  - lista de archivos por hash
  - referencias a orígenes (Modrinth/CurseForge/local)
- Backend comando:
  - `rebuild_instance_from_manifest(manifest, strategy)`
- Sync selectivo:
  - mods
  - configs
  - resourcepacks
  - saves (opt-in)

### Estrategia inicial

- Empezar con proveedor simple (bucket + API mínima).
- Diseñar interfaz para pluggable providers.

## 4) Compatibilidad predictiva previa a instalación

### Estado actual

Ya hay utilidades semver y acceso a metadatos de APIs.

### Mejora incremental

- Crear `compatibilityEngine` (frontend + backend cacheable):
  - normaliza metadatos (`depends`, `breaks`, loaders, game versions)
  - construye grafo de dependencias por instancia
  - clasifica resultado: `compatible`, `warning`, `incompatible`
- Integración UX:
  - Antes de instalar: modal con semáforo + explicación.

### Resultado esperado

Reducir crashes evitables antes de ejecutar el juego.

## 5) Sandbox / pruebas aisladas

### Estado actual

La gestión de instancias ya permite estructura de workspace y ejecución separada.

### Mejora incremental

- Añadir operación `clone_instance_as_sandbox(baseInstanceId)`.
- Guardar overlays de cambios (`.fruti/sandbox-delta.json`).
- Botones UI:
  - “Probar actualización”
  - “Aplicar cambios al perfil real”
  - “Descartar sandbox”

### Seguridad

- Nunca tocar el perfil original hasta `Apply` explícito.

## 6) Benchmark integrado

### Mejora incremental

- Capturar métricas post-lanzamiento:
  - tiempo de arranque
  - FPS promedio (si se puede leer overlay/log)
  - uso pico RAM/CPU
- Guardar histórico por instancia y comparar cambios de mods/JVM.

## 7) Editor visual de modpacks

### Mejora incremental

- Nueva vista opcional “Graph Editor”:
  - nodos = mods
  - aristas = dependencias/incompatibilidades
- Reutilizar `compatibilityEngine` como backend del grafo.

## 8) Generador automático de packs optimizados

### Mejora incremental

- Perfil objetivo (`low-end`, `balanced`, `high-fps`).
- Pipeline:
  - evaluar pack actual
  - sugerir reemplazos livianos
  - ajustar JVM via `jvmTuningService`

## Arquitectura recomendada de rollout

## Fase A (impacto alto, riesgo bajo)

1. AI Repair Engine v1 (reglas + acciones 1-click)
2. Compatibilidad predictiva v1
3. Sandbox básico

## Fase B (diferenciación fuerte)

4. Conversión servidor -> cliente
5. Perfiles nube por hashes

## Fase C (producto “pro”)

6. Benchmark
7. Editor visual
8. Optimizador automático

## Contrato de datos sugerido (mínimo)

```ts
export type CompatibilityStatus = "compatible" | "warning" | "incompatible";

export interface DiagnosticFix {
  id: string;
  title: string;
  action: "update_dependency" | "disable_mod" | "reinstall_loader" | "repair_runtime";
  confidence: number; // 0..1
}

export interface DiagnosticReport {
  summary: string;
  probableCause?: string;
  detectedMods: string[];
  missingDependencies: string[];
  fixes: DiagnosticFix[];
  rawEvidence: string[];
}
```

## KPIs de éxito (medibles)

- % de crashes resueltos automáticamente.
- Reducción de tiempo medio de “detectar + arreglar”.
- % de instalaciones bloqueadas preventivamente por incompatibilidad real.
- Ratio de adopción de sandbox y tasa de rollback exitoso.
- Tiempo de reconstrucción de perfil desde nube en equipo nuevo.

## Próximos pasos concretos (sprint 1)

1. Implementar `diagnose_instance_crash` (solo lectura, sin aplicar cambios todavía).
2. Añadir modal de diagnóstico en UI de instancia.
3. Prototipo de `compatibilityEngine` para instalación de un mod individual.
4. Feature flags para mostrar estas funciones solo en “experimental”.
