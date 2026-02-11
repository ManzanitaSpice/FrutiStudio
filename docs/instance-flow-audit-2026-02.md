# Auditoría integral del flujo de instancias (FrutiLauncher)

## Resumen ejecutivo

Se revisó el pipeline actual contra el objetivo de paridad tipo PrismLauncher y se priorizó:

- **Implementado en este cambio:**
  - Reinstalación total del launcher desde configuración (wipe de datos locales + instancias).
  - Confirmación fuerte por frase `REINSTALAR`.
  - Solicitud de elevación en Windows antes del borrado.
  - Ajuste de compatibilidad Java recomendada por versión MC (`<=1.16 => 8`, `1.17+ => 17`, `1.20.5+ => 21`).
- **Pendiente (roadmap):** paridad completa de Forge processors, resolución profunda de dependencias de mods y matriz de pruebas 1.8→latest automatizada.

## Estado rápido por bloque (1-30)

1. Estructura base por instancia: **Parcial-Alta**
2. Manifest/versions Mojang: **Alta**
3. Libraries + rules + natives: **Alta**
4. Assets pipeline: **Alta**
5. client.jar + mainClass + classpath: **Alta**
6. Classpath final: **Alta**
7. Detección Java: **Alta** (con ajuste aplicado)
8. JVM/game args y placeholders: **Alta**
9. Fabric merge/inheritsFrom: **Parcial-Alta**
10. Forge/NeoForge processors: **Parcial**
11. Dependencias automáticas de mods: **Parcial**
12. Sistema de mods + disabled: **Parcial-Alta**
13. Modpacks CF/MR/Technic: **Parcial-Alta**
14. Shaders: **Media**
15. Resourcepacks: **Media**
16. Saves/worlds: **Media**
17. Config/options presets: **Media**
18. Auth Microsoft + refresh: **Parcial**
19. Detección launcher oficial/import: **Parcial-Alta**
20. Crash logs y clasificación: **Parcial-Alta**
21. Multiplataforma: **Parcial-Alta**
22. Descarga robusta (retry/fallback): **Parcial-Alta**
23. Integridad SHA1/redownload: **Alta**
24. Repair system de instancia: **Alta**
25. Performance/memory tuning: **Parcial-Alta**
26. UX flujo estilo Prism: **Parcial-Alta**
27. Seguridad/sandboxing: **Parcial**
28. Logging/debug pipeline: **Parcial-Alta**
29. Paridad exacta Prism: **Pendiente**
30. Test matrix real: **Pendiente**

## Recomendación de siguientes entregables

1. Pipeline completo Forge/NeoForge (`runProcessors`) con validación de artefactos parchados.
2. Resolver dependencias cruzadas CF/Modrinth/fabric.mod.json/mods.toml con conflicto semver.
3. Ejecutar suite de smoke E2E por loader/version (matriz mínima nightly).
4. Endurecer autenticación MSA con refresh robusto y fallback offline controlado.
