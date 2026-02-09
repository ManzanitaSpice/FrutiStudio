import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Toolbar } from "./Toolbar";

describe("Toolbar", () => {
  it("renderiza con feature flags", () => {
    const { container } = render(
      <Toolbar
        current="mis-modpacks"
        onSelect={() => undefined}
        showGlobalSearch
        flags={{
          explorer: true,
          news: true,
          servers: true,
          settings: true,
        }}
        onThemeChange={() => undefined}
        theme="system"
      />,
    );

    expect(container).toMatchSnapshot();
  });
});
