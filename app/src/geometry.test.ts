import { describe, expect, it } from "vitest";
import { borderPoint, edgeGeom, midpoint, orthogonalGeom, type Box } from "./geometry";

describe("borderPoint", () => {
  const box: Box = { cx: 0, cy: 0, w: 100, h: 60 };
  it("exits the vertical edge when aimed sideways", () => {
    expect(borderPoint(box, { x: 1000, y: 0 })).toEqual({ x: 50, y: 0 });
  });
  it("exits the horizontal edge when aimed up/down", () => {
    expect(borderPoint(box, { x: 0, y: 1000 })).toEqual({ x: 0, y: 30 });
  });
});

describe("edgeGeom", () => {
  const src: Box = { cx: 0, cy: 0, w: 100, h: 60 };
  const dst: Box = { cx: 400, cy: 0, w: 100, h: 60 };

  it("handle sits at the straight midpoint when unbent", () => {
    const g = edgeGeom(src, dst, [0, 0]);
    expect(g.handle).toEqual(midpoint({ x: 0, y: 0 }, { x: 400, y: 0 }));
  });

  it("the curve passes through the dragged handle", () => {
    const bend: [number, number] = [30, -80];
    const g = edgeGeom(src, dst, bend);
    // B(0.5) of M p0 Q ctrl p1 must equal the handle M — the bend is grabbable on-curve.
    const m = /M ([\d.-]+) ([\d.-]+) Q ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/.exec(g.path)!;
    const [p0x, p0y, cx, cy, p1x, p1y] = m.slice(1).map(Number) as [
      number, number, number, number, number, number,
    ];
    const bx = 0.25 * p0x + 0.5 * cx + 0.25 * p1x;
    const by = 0.25 * p0y + 0.5 * cy + 0.25 * p1y;
    expect(bx).toBeCloseTo(g.handle.x, 1);
    expect(by).toBeCloseTo(g.handle.y, 1);
    expect(g.handle).toEqual({ x: 200 + 30, y: 0 - 80 });
  });
});

describe("orthogonalGeom lanes", () => {
  // One parent above four children — the fan that used to draw four edges on one line.
  // Kept narrow and tall on purpose: orthogonalGeom picks the axis with the larger separation,
  // so a fan that is wider than it is deep routes sideways and none of this applies.
  const parent: Box = { cx: 400, cy: 100, w: 200, h: 80 }; // bottom edge at y=140
  const kids: Box[] = [0, 1, 2, 3].map((i) => ({ cx: 250 + i * 100, cy: 400, w: 90, h: 60 }));
  const bandTop = 140; // parent bottom
  const bandBottom = 370; // child top (400 - 30)
  // The corner is the Q control point. The preceding L is pulled back by the corner radius,
  // so reading that instead reports a turn ~12px off — enough to look like the band was missed.
  const turnY = (path: string): number => Number(/Q [\d.-]+ ([\d.-]+)/.exec(path)![1]);

  it("puts the turn at the middle of the clear band when there is no lane", () => {
    const g = orthogonalGeom(parent, kids[0]!, [0, 0]);
    expect(turnY(g.path)).toBeCloseTo((bandTop + bandBottom) / 2, 0);
  });

  it("gives every edge of a fan its own turn", () => {
    const ys = kids.map((k, i) => turnY(orthogonalGeom(parent, k, [0, 0], { index: i, count: 4 }).path));
    expect(new Set(ys).size).toBe(4);
  });

  it("keeps every turn strictly inside the band, so no run can land on a box", () => {
    for (const count of [1, 4, 12]) {
      for (let i = 0; i < count; i++) {
        const y = turnY(orthogonalGeom(parent, kids[0]!, [0, 0], { index: i, count }).path);
        expect(y).toBeGreaterThan(bandTop);
        expect(y).toBeLessThan(bandBottom);
      }
    }
  });

  it("still honours a dragged bend on top of the lane", () => {
    const plain = turnY(orthogonalGeom(parent, kids[1]!, [0, 0], { index: 1, count: 4 }).path);
    const bent = turnY(orthogonalGeom(parent, kids[1]!, [0, 25], { index: 1, count: 4 }).path);
    expect(bent - plain).toBeCloseTo(25, 0);
  });
});
