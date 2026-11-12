import { describe, expect, it } from "vitest";
import { edgeStyle } from "./edge";
import { content } from "./geometry";
import type { SeedNode } from "./model";

function node(kind: string): SeedNode {
  return { key: "m.py#X", name: "X", module: "m.py", kind, lang: "python", doc: "", attributes: [], methods: [] };
}

describe("metaclass", () => {
  it("a metaclass box carries the «metaclass» stereotype and an upright name", () => {
    const c = content(node("metaclass"));
    expect(c.stereotype).toBe("«metaclass»");
    expect(c.italic).toBe(false);
  });

  it("the existing stereotypes are unchanged", () => {
    expect(content(node("interface")).stereotype).toBe("«interface»");
    expect(content(node("struct")).stereotype).toBe("«struct»");
    expect(content(node("class")).stereotype).toBe("");
  });

  it("instanceof is a dashed arrow to the metaclass", () => {
    const s = edgeStyle({ src: "m.py#A", dst: "m.py#Meta", kind: "instanceof", lazy: false });
    expect(s.dash).toBe("6 4");
    expect(s.markerEnd).toBe("m-arrow-rust");
    expect(s.markerStart).toBeNull();
  });
});
