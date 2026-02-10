# Flujo CurseForge estilo Prism (implementación en FrutiStudio)

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
