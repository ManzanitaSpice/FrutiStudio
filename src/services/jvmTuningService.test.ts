import { describe, expect, it } from "vitest";

import { buildJvmRecommendation } from "./jvmTuningService";

describe("buildJvmRecommendation", () => {
  it("usa preset legacy en Java < 17", () => {
    const recommendation = buildJvmRecommendation({
      javaVersion: 11,
      totalSystemRamMb: 8192,
      modsCount: 90,
      isClient: true,
    });

    expect(recommendation.preset.id).toBe("legacy");
    expect(recommendation.javaArgs).toContain("-XX:+UseG1GC");
  });

  it("recorta Xmx para no exceder 60% de RAM del sistema", () => {
    const recommendation = buildJvmRecommendation({
      javaVersion: 21,
      totalSystemRamMb: 8192,
      modsCount: 250,
      isClient: true,
    });

    expect(recommendation.maxMemoryMb).toBeLessThanOrEqual(Math.round(8192 * 0.6));
  });

  it("eleva Xms en modpacks pesados", () => {
    const recommendation = buildJvmRecommendation({
      javaVersion: 21,
      totalSystemRamMb: 16384,
      modsCount: 200,
      isClient: true,
    });

    expect(recommendation.minMemoryMb).toBeGreaterThanOrEqual(
      Math.round(recommendation.maxMemoryMb * 0.5),
    );
  });
});
