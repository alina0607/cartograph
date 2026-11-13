// What a click on a legend row lights up. A row is picked as `by:value`:
//   edge:<relation kind>   those arrows, and the classes at both ends of them
//   kind:<node kind>       the boxes of that colour (class, abstract, stdlib, ML, …), and the
//                          arrows that touch them
//   lang:<language>        that language's classes, and the arrows that touch them
// Pure (no DOM), so it is unit-tested; main.ts applies the result as CSS classes.

import { edgeKey } from "./edge";
import type { Seed } from "./model";

export interface Lit {
  edges: Set<string>; // edge keys drawn bold
  touch: Set<string>; // edge keys kept visible, at normal weight
  nodes: Set<string>; // node keys kept visible and outlined
}

export function litBy(seed: Seed, pick: string): Lit {
  const cut = pick.indexOf(":");
  const by = pick.slice(0, cut);
  const value = pick.slice(cut + 1);
  const lit: Lit = { edges: new Set(), touch: new Set(), nodes: new Set() };
  if (by === "edge") {
    for (const rel of seed.relations) {
      if (rel.kind !== value) continue;
      lit.edges.add(edgeKey(rel));
      lit.nodes.add(rel.src);
      lit.nodes.add(rel.dst);
    }
    return lit;
  }
  for (const n of seed.nodes) {
    if ((by === "kind" && n.kind === value) || (by === "lang" && n.lang === value)) {
      lit.nodes.add(n.key);
    }
  }
  for (const rel of seed.relations) {
    if (lit.nodes.has(rel.src) || lit.nodes.has(rel.dst)) lit.touch.add(edgeKey(rel));
  }
  return lit;
}
