import { describe, expect, it } from "vitest";
import { edgeStyle } from "./edge";
import { content } from "./geometry";
import type { SeedNode } from "./model";

function node(kind: string, module = "m.py"): SeedNode {
  return { key: `${module}#X`, name: "X", module, kind, lang: "python", doc: "", attributes: [], methods: [] };
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

describe("classes outside the scan", () => {
  it("name their package as the stereotype", () => {
    expect(content(node("library", "torch.nn")).stereotype).toBe("«torch.nn»");
    expect(content(node("stdlib", "collections")).stereotype).toBe("«collections»");
  });
});
