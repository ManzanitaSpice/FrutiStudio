# Análisis completo: reparación de loaders y robustez de instalación

## Contexto del error reportado
Error observado:

- `No se pudo ejecutar repair_instance`
- `La reinstalación terminó con validaciones fallidas`
- `Fallo en requisito crítico: perfil_loader_valido`

El fallo ocurre en la validación final del `launch-plan` cuando la cadena del perfil de loader no pasa los checks internos.

## Investigación en línea (evidencia técnica)
Se verificaron endpoints reales de metadatos/maven usados por el launcher:

1. `https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml`
2. `https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml`

Hallazgo clave: ciertos servidores maven/infra responden distinto cuando falta `User-Agent` (incluyendo 403 en algunos clientes HTTP), por lo que se reforzó el cliente con `User-Agent` explícito en resolución de versiones.

## 15 errores resueltos (diagnóstico + solución)

1. **Validación rígida de `inheritsFrom` para Forge/NeoForge**
   - Antes exigía igualdad exacta con versión vanilla.
   - Ahora acepta cadena base compatible (`1.21.1` o prefijos como `1.21.1-*` según perfil forge-like).

2. **Validación de `jar` rígida para perfiles forge-like**
   - Antes rechazaba `jar` distinto a vanilla aunque fuera válido para perfil instalado.
   - Ahora permite `jar == vanilla` o `jar == profile_id` para Forge/NeoForge.

3. **`perfil_loader_valido` dependía del `file_stem` del JSON persistido**
   - Antes podía derivar mal la versión base (ej. `.runtime/version.json` -> `version`).
   - Ahora se toma `inheritsFrom` real del perfil de lanzamiento.

4. **Derivación incorrecta de base para loaders forge-like**
   - Antes no se normalizaba `inheritsFrom` con sufijos de loader.
   - Ahora se recorta de forma segura a base MC para validar cadena del loader.

5. **Firma de validación sin contexto de loader**
   - `validate_loader_profile_json` no distinguía reglas por loader.
   - Ahora recibe `loader` y aplica reglas por familia (Fabric/Quilt vs Forge/NeoForge).

6. **Mensajes poco accionables al fallar instalador Forge/NeoForge**
   - Antes: solo código de salida.
   - Ahora: incluye rutas de logs + tail de stdout/stderr para diagnóstico inmediato.

7. **Resolución “latest” sensible a bloqueos de maven por agente HTTP**
   - Antes: requests sin `User-Agent` explícito.
   - Ahora: encabezado `User-Agent` definido en resolutores de versión.

8. **Riesgo de elegir versión inestable/no estable en Fabric/Quilt**
   - Antes: primera entrada del array.
   - Ahora: prioriza `loader.stable == true`, luego fallback al primer resultado.

9. **Inconsistencia entre validación de perfil y bootstrap real**
   - Antes el bootstrap podía generar perfil válido pero el validador lo rechazaba por reglas genéricas.
   - Ahora ambas rutas usan reglas coherentes por loader.

10. **Falsos negativos en `perfil_loader_valido` tras reinstall**
    - Antes: reconstrucción del plan no usaba la información más confiable del perfil launch real.
    - Ahora: se valida contra el JSON de `--version` en `versions/<id>/<id>.json`.

11. **Diagnóstico tardío de corrupción de cadena de perfil**
    - Antes: difícil distinguir error de metadatos vs error de jar.
    - Ahora: validación separada de `inheritsFrom` y `jar` con mensajes distintos.

12. **Dificultad para soporte en campo (logs incompletos)**
    - Antes: operador debía abrir archivos manualmente.
    - Ahora: se agregan últimas líneas en el error final para soporte remoto rápido.

13. **Variabilidad de infraestructura externa no absorbida por cliente**
    - Antes: clientes HTTP mínimos podían ser bloqueados.
    - Ahora: petición más robusta con cabecera agente en múltiples resolutores.

14. **Acoplamiento de validación a un único patrón de perfil**
    - Antes: asumía estructura tipo Fabric para todos.
    - Ahora: compatibilidad explícita para patrones forge-like.

15. **Reparación completa podía terminar en bucle de falla por regla inválida**
    - Antes: reinstall repetido con mismo criterio defectuoso.
    - Ahora: criterio de validación corregido, reduciendo bucles de `repair_instance` fallido.

## Mejora del flujo de descarga e instalación de loaders

### Descarga
- Se fortalece la resolución de versiones al usar `User-Agent` explícito en endpoints de Forge/NeoForge/Fabric/Quilt.
- Se conserva fallback de endpoints ya existente, pero con mejor compatibilidad frente a servidores estrictos.

### Instalación
- Forge/NeoForge ahora tienen validación de perfil alineada con su estructura real (`inheritsFrom` y `jar`).
- Al fallar instalación, se devuelve telemetría legible (tail de logs) para corrección inmediata.

### Validación post-instalación
- `perfil_loader_valido` deja de depender de una inferencia frágil y valida contra el perfil real generado.
- Se disminuyen falsos positivos de corrupción en instalaciones funcionales.

## Resultado esperado
Con estos cambios:

- baja drásticamente el error `Fallo en requisito crítico: perfil_loader_valido`;
- mejora la tasa de éxito en `repair_instance` para Forge/NeoForge;
- mejora la observabilidad para resolver incidentes reales de instalación/descarga.
