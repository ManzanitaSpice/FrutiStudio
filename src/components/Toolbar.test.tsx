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
        isFocusMode={false}
        flags={{
          explorer: true,
          news: true,
          servers: true,
          settings: true,
          community: true,
        }}
        onBack={() => undefined}
        onForward={() => undefined}
        canGoBack={false}
        canGoForward={false}
        onSearchSubmit={() => undefined}
      />,
    );

    expect(container).toMatchSnapshot();
  });
});
