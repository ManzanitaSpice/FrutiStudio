# Plan de diagnóstico y hardening para errores de arranque (Fabric/Forge/Quilt)

Este documento consolida una guía operativa para errores como:

- `Minecraft cerró durante el arranque (código 1)`
- stacktrace en `org.objectweb.asm.ClassReader`
- fallos en `net.fabricmc.loader.minecraft.McVersionLookup`

## Qué significa el error `ClassReader` + `McVersionLookup`

Cuando Fabric falla en `McVersionLookup.fromAnalyzer/getVersion`, normalmente no puede leer correctamente el `jar` de Minecraft o su metadata de versión. En la práctica, esto suele ocurrir por:

1. **Desalineación entre versión de Minecraft y loader**.
2. **Instancia incompleta o corrupta** (`versions/<version>/<version>.jar`, `assets`, `natives`).
3. **Classpath inválido** (orden, rutas o `jars` faltantes/duplicados).
4. **Mods incompatibles o dañados**.

## Checklist de verificación mínima antes de lanzar

1. **Estructura de instancia**
   - `versions/<version>/<version>.jar` presente y legible.
   - `assets/` completo.
   - `natives/` extraído correctamente para el SO/arquitectura.
   - `libraries/` presentes según `version_manifest`.

2. **Detección de loader**
   - Fabric: `fabric-loader-<ver>.jar`
   - Forge: `forge-<ver>.jar` / bootstrapper correspondiente
   - Quilt: `quilt-loader-<ver>.jar`
   - Sin loader: Vanilla

3. **Compatibilidad**
   - Loader compatible con la versión exacta de Minecraft.
   - Mods compatibles con loader + versión objetivo.
   - Dependencias de mods resueltas.

4. **Main class correcta por tipo de instancia**
   - Vanilla: `net.minecraft.client.main.Main`
   - Fabric/Quilt: `net.fabricmc.loader.launch.knot.KnotClient`
   - Forge: main class según versión de Forge instalada

5. **Classpath y argumentos JVM**
   - Incluir loader + `minecraft.jar` + librerías requeridas.
   - `-Djava.library.path=<natives>` válido.
   - Variables de launcher completas (`--gameDir`, `--assetsDir`, `--version`, `--accessToken`, etc.).

## Procedimiento de diagnóstico recomendado (runtime)

1. Intentar arranque normal y capturar `stdout/stderr` completo.
2. Si falla con código 1:
   - Ejecutar preflight extendido (jar MC, libraries, natives, main class, Java).
   - Probar arranque en **modo seguro** (sin mods).
3. Si modo seguro arranca:
   - Reintroducir mods por lotes o uno a uno para localizar el conflicto.
4. Si modo seguro no arranca:
   - Reparar runtime (redescarga de `jar`, `asset index`, `libraries`, `natives`, loader).
5. Persistir diagnóstico en log por instancia con resumen accionable.

## Mejoras técnicas prioritarias para Interface

1. **Gestión automática de Java**
   - Detectar múltiples instalaciones (17/21 y ruta real).
   - Elegir versión correcta por instancia + loader.
   - Verificar arquitectura (x64/arm64) antes del launch.

2. **Gestión de loaders**
   - Resolver automáticamente tipo y versión del loader.
   - Cachear loaders descargados.
   - Bloquear combinaciones incompatibles (mods Fabric en Forge, etc.).

3. **Classpath dinámico y validado**
   - Construcción determinística por tipo de instancia.
   - Detección de duplicados y rutas inválidas.
   - Validación previa de `main class` y artefactos críticos.

4. **Assets/Natives robustos**
   - Verificación y extracción incremental.
   - Carpeta temporal única de natives por instancia/ejecución.
   - Limpieza de temporales obsoletos.

5. **Logging de diagnóstico profesional**
   - Logs separados por instancia/loader.
   - Clasificación de errores (`ClassNotFound`, `NoClassDefFound`, versión incompatible, etc.).
   - Recomendaciones automáticas en lenguaje claro.

6. **UX de soporte**
   - Mostrar antes de iniciar: Java activo, loader, versión MC, memoria y cantidad de mods.
   - Botones de acciones rápidas: “Reparar runtime”, “Arrancar sin mods”, “Abrir carpeta logs”.

## Señales de alerta específicas para Fabric

- Error en `McVersionLookup` suele implicar problema de lectura del `minecraft.jar` o mismatch entre loader y versión objetivo.
- Si se está usando Fabric, no lanzar con `net.minecraft.client.main.Main`; debe usarse `KnotClient`.
- La reparación debe priorizar: `versions/<mc>/<mc>.jar`, `fabric-loader`, `libraries` ASM/Fabric Loader.

## Resultado esperado

Con estas validaciones y flujos de recuperación, el usuario debería recibir mensajes accionables (en vez de solo “código 1”) y poder recuperar instancias rotas con uno o dos clics.
