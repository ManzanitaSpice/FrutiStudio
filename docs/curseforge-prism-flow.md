# Flujo CurseForge estilo Prism (implementación en FrutiLauncher)

## 1) Importar modpack CurseForge

1. Leer `manifest.json` del ZIP importado.
2. Extraer `projectID` + `fileID` de cada entrada.
3. Para cada archivo, consultar metadata oficial en CurseForge.
4. Resolver política de descarga:
   - Si el archivo permite descarga por API, usar descarga automática.
   - Si no permite, forzar fallback manual (abrir URL oficial en navegador).

## 2) Descarga con fallback legal

Este repo ahora expone el comando Tauri `curseforge_resolve_download` para resolver cada archivo:

- `canAutoDownload = true`: usar `downloadUrl`.
- `canAutoDownload = false`: mostrar acción manual con `websiteUrl`.

No se hardcodea CDN y no se evita `allowModDistribution`/disponibilidad del archivo.

## 3) Fingerprints de mods instalados

Este repo ahora expone el comando Tauri `curseforge_scan_fingerprints`:

1. Escanea `mods/` y toma `*.jar`.
2. Calcula `MurmurHash2` localmente.
3. Envía hashes a `POST /v1/fingerprints`.
4. Clasifica cada archivo en `matched`/`unmatched` para UI.

## 4) Contrato frontend

Se agregó `src/services/curseforgeComplianceService.ts` con funciones:

- `scanLocalModsWithCurseforgeFingerprints(...)`
- `resolveCurseforgeDownloadAction(...)`

Modelo de estado recomendado de UI:

- `OK` (match exacto)
- `Update` (cuando detectes archivo más nuevo para mismo mod)
- `Manual` (sin descarga automática)
- `Unknown` (fingerprint sin match)

## 5) Buenas prácticas

- Nunca exponer API key en frontend público.
- Todas las llamadas a CurseForge pasan por backend Tauri.
- Mantener fallback a navegador como parte del flujo normal, no como excepción.

## 6) Qué sí aprovechar del fragmento de Prism que compartiste

El fragmento es útil **como guía de producto/arquitectura**, no para copiar código literal:

1. **Pantalla de “Services / APIs” con campos de override**
   - Prism maneja claves/tokens como `FlameKeyOverride`, `ModrinthToken`, `UserAgentOverride`, y persistencia centralizada.
   - En FrutiLauncher ya existe un campo para la API key de CurseForge en `SettingsPanel`; lo más valioso sería mover ese valor a un flujo 100% backend (Tauri) y mantener en frontend solo UX de entrada/validación.

2. **Validaciones y saneamiento de URL/config**
   - Prism valida URLs y fuerza HTTPS en endpoints inseguros.
   - Si abres overrides de endpoints en FrutiLauncher (ej. para staging/proxy), conviene replicar esa política: validar formato, normalizar barra final y bloquear `http` no-localhost.

3. **Controles operativos para red/tareas**
   - El UI de Prism expone concurrencia, retries y timeout HTTP.
   - Esto encaja bien con errores intermitentes de catálogo/descarga en CurseForge: añadir esos parámetros en configuración (aplicados en backend) ayudaría a estabilidad.

4. **Metadata y dependencias automáticas**
   - Prism tiene toggles de “Keep track of mod metadata” e “Install dependencies automatically”.
   - Son directamente aplicables para mejorar UX de actualización/modpack en FrutiLauncher si aún no están configurables.

5. **Detección de mods “bloqueados” en descargas**
   - Prism contempla revisar subcarpetas de Downloads y mover/copiar recursos bloqueados.
   - Para FrutiLauncher sirve como patrón de fallback legal y trazabilidad cuando no hay descarga directa.

## 7) Qué NO tomar tal cual

- **No copiar código GPL/Apache directamente** del snippet de Prism si no quieres heredar obligaciones/licenciamiento en bloque. Úsalo como referencia funcional y reimplementa la lógica.
- La parte de `PasteUpload`/servicios de logs no impacta directamente la integración de CurseForge.
- La clase base `ResourceAPI` sirve como patrón abstracto (search/info/versions/dependencies), pero no arregla por sí sola fallos concretos de autenticación o rate limit.

## 8) Prioridad recomendada para “hacer que CurseForge funcione”

1. Mover clave y llamadas al backend (si queda alguna ruta directa en frontend).
2. Añadir validación/saneamiento de endpoint y cabeceras.
3. Hacer configurables timeout/retries/concurrency para requests de CurseForge.
4. Añadir “health check” de API key (ping simple) y feedback claro en Settings.
5. Mantener fallback manual como flujo de primera clase.

## 9) Estado aplicado en esta rama

Se aplicó el flujo para que CurseForge quede visible y descargable desde el mismo diálogo de producto:

- El catálogo de CurseForge ya no se bloquea por categorías no mapeadas (usa búsqueda global cuando no hay `classId`).
- El detalle de versiones conserva `modId` + `fileId` para resolver descarga legal con `curseforge_resolve_download`.
- El botón **Descargar** usa resolución automática/manual (igual que Modrinth, donde abre URL directa de versión).
- Si falta API key de CurseForge, se abre fallback a `websiteUrl` sin romper el flujo.

Con esto el flujo queda consistente: **catálogo visible + descarga directa cuando está permitida + fallback manual cuando no**.
