# Roadmap de innovación: integrar funciones avanzadas sin romper el launcher

## Objetivo

Convertir Fruti Launcher en una plataforma **predictiva y auto-reparable** sin reescribir el core ni introducir regresiones en los flujos actuales de instancias/mods/loaders.

Principio guía: **extender por capas**, activando cada capacidad con feature flags y observabilidad antes de habilitarla por defecto.

---

## Lo que ya tenemos (base real para construir)

Fruti ya tiene piezas clave que reducen mucho el costo de implementación:

- Core de reparación modular (`assets`, `libraries`, `mods`, `version`, `loader`, `config`, `world`) con un `repair_manager` central.
- Pipeline de lanzamiento determinístico y validadores preflight en backend.
- Servicios frontend/backend para perfiles, instancias, modpacks, descargas con hash y cola.
- Sistema de feature flags, notificaciones, telemetría opcional y paneles UI desacoplados.
- Investigación y hardening previo en diagnóstico de arranque y reparación de loaders.

Esto significa que no partimos de cero: la estrategia correcta es **orquestación inteligente + UX operativa** sobre capacidades existentes.

---

## Diseño de integración por cada idea innovadora

## 1) AI Repair Engine (diagnóstico automático con fixes 1-click)

### Estado actual aprovechable
- Reparación por módulos ya implementada en Rust.
- Logging y diagnósticos de arranque ya considerados en docs y servicios.

### Qué falta
- Parseador semántico de crash logs.
- Motor de reglas (causa -> fix sugerido).
- Contrato de “fix aplicable” con confirmación de usuario.

### Implementación incremental (sin romper)
1. **Fase A — Read only**
   - Nuevo módulo `crash_intelligence` que clasifique errores comunes (`NoClassDefFoundError`, `Mixin`, dependencias faltantes, Java mismatch).
   - Solo devuelve diagnóstico y confianza (`high/medium/low`), sin modificar archivos.
2. **Fase B — Sugerencias accionables**
   - Generar `suggested_actions[]` (actualizar dependencia, deshabilitar mod, cambiar loader, reparar librerías).
3. **Fase C — One-click fix transaccional**
   - Ejecutar acciones vía `repair_manager` con backup previo y rollback en caso de fallo.

### Guardrails
- Feature flag: `aiRepairEngine`.
- Aplicar auto-fix solo con confianza alta + confirmación explícita.
- Auditoría: registrar acción, archivos tocados y resultado.

---

## 2) Conversión universal Cliente ↔ Servidor (bidireccional)

### Estado actual aprovechable
- Servicios de servidor, catálogos y flujo de instancias ya presentes.
- Import/export de modpacks y utilidades de versiones/loaders existentes.

### Qué falta
- Formato canónico común para describir una instalación (manifest unificado).
- Motor de diff/sync entre carpetas cliente y servidor.

### Implementación incremental
1. **Manifest canónico interno**
   - Definir `UnifiedInstanceManifest` (mcVersion, loader, mods, config fingerprints, overrides).
2. **Importador de servidor -> perfil cliente**
   - Detectar loader/versión/mods/config y crear “perfil espejo”.
3. **Sync bidireccional guiado**
   - Vista de diferencias (solo-en-cliente, solo-en-servidor, conflicto).
4. **Políticas por tipo de archivo**
   - Ignorar mundos/logs/cache por defecto para evitar daños.

### Guardrails
- Modo dry-run primero, luego aplicar.
- Copia de seguridad automática de `mods/` y `config/`.

---

## 3) Perfiles en la nube con reconstrucción por hash

### Estado actual aprovechable
- `profileService` y servicios de instancia/modpack ya operativos.
- Descarga con hash/reintentos ya implementada.

### Qué falta
- Esquema de manifiesto remoto y estrategia de sincronización selectiva.
- Resolución de conflictos multi-dispositivo.

### Implementación incremental
1. **Cloud Manifest v1**
   - Subir solo metadatos + hashes (sin binarios pesados).
2. **Rehidratación en nuevo equipo**
   - Resolver hashes contra proveedores (Modrinth/CurseForge/local cache).
3. **Sync selectivo**
   - Usuario elige qué instancias/configs sincronizar.
4. **Estrategia de conflicto**
   - Last-write-wins + historial corto + opción manual.

### Guardrails
- Cifrado en tránsito y tokens con expiración.
- No sincronizar credenciales ni secretos locales.

---

## 4) Compatibilidad predictiva antes de instalar

### Estado actual aprovechable
- Integraciones con APIs de contenido y resolutores de versiones/loaders.
- Utilidades semver y manejo de metadata.

### Qué falta
- Grafo de dependencias unificado y evaluador de riesgo previo.
- Score visible en UI antes de confirmar instalación.

### Implementación incremental
1. **Dependency Graph Builder**
   - Normalizar dependencias/restricciones por proveedor.
2. **Compatibility Simulator**
   - Simular instalación contra estado actual de la instancia.
3. **Risk scoring UX**
   - Resultado: `Compatible`, `Posible conflicto`, `Incompatible` + explicación humana.
4. **Fix hints**
   - Sugerir dependencias faltantes o versión alternativa compatible.

### Guardrails
- No bloquear instalación en fase inicial; solo advertir.
- Registrar falsos positivos/negativos para recalibrar reglas.

---

## 5) Sandbox / pruebas aisladas

### Estado actual aprovechable
- Gestión de instancias y pipeline de ejecución separados por perfil.

### Qué falta
- Clonado rápido con deduplicación (hardlinks o cache compartida).
- Comparador de resultados (arranque/crash/performance básico).

### Implementación incremental
1. **Crear sandbox clonable**
   - Botón “Probar actualización” crea copia temporal de la instancia.
2. **Ejecución aislada**
   - Mods/config en overlay temporal.
3. **Comparación post-run**
   - Mostrar si arrancó, tiempo de inicio, errores clave.
4. **Promote/Discard**
   - “Aplicar cambios al perfil original” o “descartar”.

### Guardrails
- TTL automático para limpiar sandboxes huérfanos.
- Límite de espacio configurable.

---

## Orden recomendado de entrega (impacto vs riesgo)

1. **AI Repair Engine (read-only + sugerencias)**
2. **Compatibilidad predictiva (solo advertencias)**
3. **Sandbox aislado**
4. **Conversión Cliente ↔ Servidor**
5. **Nube + reconstrucción por hash**

Razonamiento: primero maximizar valor inmediato de soporte/estabilidad, luego introducir sincronización y flujos distribuidos más complejos.

---

## Arquitectura transversal para no romper nada

## Patrones técnicos
- **Feature flags por capacidad** (frontend + backend).
- **Comandos Tauri nuevos y opt-in**, sin alterar contratos existentes.
- **Módulos puros de análisis** (sin side effects) separados de módulos de ejecución.
- **Ejecución transaccional** para acciones de reparación/sync (backup + rollback).

## Observabilidad mínima obligatoria
- Eventos: diagnóstico emitido, sugerencia aceptada/rechazada, fix éxito/fallo.
- Métricas: crash recurrence rate, first-fix success rate, tiempo medio de recuperación.

## Estrategia de pruebas
- Unit tests para parseo de logs y simulador de compatibilidad.
- Integration tests para repair actions con fixtures corruptos controlados.
- E2E smoke tests: instalar mod, detectar conflicto, sugerir fix, aplicar fix.

---

## Backlog técnico propuesto (épicas)

1. **Epic A: Crash Intelligence Core**
   - Parser + catálogo de firmas + confidence scoring.
2. **Epic B: Predictive Compatibility Core**
   - Grafo + simulador + risk scoring.
3. **Epic C: Sandbox Engine**
   - Clonado + ejecución aislada + promote/discard.
4. **Epic D: Unified Manifest & Sync**
   - Manifest canónico + conversión cliente/servidor + diff engine.
5. **Epic E: Cloud Profiles**
   - Persistencia remota + rehidratación + conflictos.

---

## Qué mejorar de lo actual desde ya (quick wins)

- Estandarizar estructura de errores del backend (código, causa, sugerencia).
- Adjuntar contexto de diagnóstico en notificaciones UI (acción recomendada directa).
- Añadir “modo diagnóstico” en panel de instancias con timeline de eventos.
- Consolidar docs de reparación + arranque en una guía operativa única.

---

## Resultado esperado

Con este plan, Fruti Launcher pasa de “gestor de mods e instancias” a **sistema inteligente de operación Minecraft**, con foco en:

- Menos tiempo en depurar crashes.
- Menos instalaciones rotas por incompatibilidad.
- Mayor seguridad al probar cambios.
- Portabilidad real entre equipos.
- Flujo cliente/servidor sin fricción.

Diferenciación real: **no solo instala contenido, lo entiende, lo valida y lo recupera automáticamente**.
