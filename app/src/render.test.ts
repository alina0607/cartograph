import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Seed, SeedNode } from "./model";
import { renderScene } from "./render";
import { Store } from "./store";

function node(name: string): SeedNode {
  return {
    key: `m/${name}.py#${name}`,
    name,
    module: `m/${name}.py`,
    kind: "class",
    lang: "python",
    doc: "",
    attributes: [],
    methods: [],
  };
}

const seed: Seed = {
  version: 1,
  nodes: [node("Base"), node("Child"), node("Owner")],
  relations: [
    { src: "m/Child.py#Child", dst: "m/Base.py#Base", kind: "inherits", lazy: false },
    { src: "m/Owner.py#Owner", dst: "m/Base.py#Base", kind: "composition", lazy: false },
  ],
};

describe("drawing order", () => {
  // The store saves through window.setTimeout; Node's global object has setTimeout too.
  beforeAll(() => vi.stubGlobal("window", globalThis));

  for (const mode of ["curved", "orthogonal"] as const) {
    it(`draws every end marker over the classes (${mode})`, () => {
      const store = new Store(seed, `render-test-${mode}`);
      if (store.edgeMode() !== mode) store.toggleEdgeMode();
      const svg = renderScene(store);
      const lastBox = svg.lastIndexOf('<g class="nd');
      // Attribute values are quoted and an edge key contains ">", so match by quotes.
      const groups = [...svg.matchAll(/<g class="edge" data-edge="[^"]*" data-kind="[^"]*"( data-marks="1")?>/g)];
      const marks = groups.filter((m) => m[1]).map((m) => m.index!);
      const lines = groups.filter((m) => !m[1]).map((m) => m.index!);
      expect(marks).toHaveLength(2); // a triangle on the inheritance, a diamond on the composition
      expect(lines).toHaveLength(2);
      for (const at of marks) expect(at).toBeGreaterThan(lastBox);
      for (const at of lines) expect(at).toBeLessThan(svg.indexOf('<g class="nd'));
    });
  }
});
