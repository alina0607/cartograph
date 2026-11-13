import { describe, expect, it } from "vitest";
import { litBy } from "./legendPick";
import type { Seed, SeedNode } from "./model";

function node(key: string, kind: string, lang = "python"): SeedNode {
  return { key, name: key, module: "", kind, lang, doc: "", attributes: [], methods: [] };
}

// Meta inherits ABCMeta (stdlib); Base is an instance of Meta; Net inherits torch's Module.
const seed: Seed = {
  version: 1,
  nodes: [
    node("Base", "abstract"),
    node("Meta", "metaclass"),
    node("Net", "class"),
    node("abc#ABCMeta", "stdlib"),
    node("torch.nn#Module", "ml"),
    node("Shape", "class", "typescript"),
  ],
  relations: [
    { src: "Meta", dst: "abc#ABCMeta", kind: "inherits", lazy: false },
    { src: "Net", dst: "torch.nn#Module", kind: "inherits", lazy: false },
    { src: "Base", dst: "Meta", kind: "instanceof", lazy: false },
  ],
};

describe("litBy", () => {
  it("an arrow kind lights its arrows and the classes at both ends", () => {
    const lit = litBy(seed, "edge:inherits");
    expect([...lit.edges]).toEqual(["Meta>abc#ABCMeta>inherits", "Net>torch.nn#Module>inherits"]);
    expect([...lit.nodes].sort()).toEqual(["Meta", "Net", "abc#ABCMeta", "torch.nn#Module"]);
    expect(lit.touch.size).toBe(0);
  });

  it("a box colour lights those classes and keeps the arrows that touch them", () => {
    const lit = litBy(seed, "kind:stdlib");
    expect([...lit.nodes]).toEqual(["abc#ABCMeta"]);
    expect([...lit.touch]).toEqual(["Meta>abc#ABCMeta>inherits"]);
    expect(lit.edges.size).toBe(0);
    expect([...litBy(seed, "kind:ml").nodes]).toEqual(["torch.nn#Module"]);
  });

  it("works for the scanned kinds too", () => {
    expect([...litBy(seed, "kind:metaclass").nodes]).toEqual(["Meta"]);
    expect([...litBy(seed, "kind:metaclass").touch].sort()).toEqual([
      "Base>Meta>instanceof",
      "Meta>abc#ABCMeta>inherits",
    ]);
  });

  it("a language lights that language's classes", () => {
    expect([...litBy(seed, "lang:typescript").nodes]).toEqual(["Shape"]);
  });
});
