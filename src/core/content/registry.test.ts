import { describe, expect, it } from "vitest";
import { ContentProviderRegistry } from "./registry";

describe("ContentProviderRegistry", () => {
  it("incluye provider privado plug & play", async () => {
    const registry = new ContentProviderRegistry({
      privateCatalog: [
        {
          id: "perf-core",
          name: "Performance Core",
          downloadUrl: "https://cdn.example.com/perf-core.jar",
          dependencies: ["fabric-api"],
        },
      ],
    });

    const provider = registry.getProvider("private");
    const search = await provider.search({ query: "perf" });
    const dependencyList = await provider.resolveDependencies("perf-core");

    expect(search[0]?.id).toBe("perf-core");
    expect(dependencyList).toEqual([
      {
        id: "fabric-api",
        required: true,
        source: "private",
      },
    ]);
  });
});
