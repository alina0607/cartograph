// Viewport maths shared by the opening fit and the wheel. Kept free of the DOM so it can be
// unit-tested: given the drawing's bounds and the window size, where should the camera be?

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
const PAD = 50;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface View {
  panX: number;
  panY: number;
  zoom: number;
}

// The view that shows every box at once, centred, with a margin. It never enlarges past 100%
// (a three-class board stays at natural size) and never shrinks below MIN_ZOOM. A board too
// big even at MIN_ZOOM starts at its top-left corner; the reader pans from there. `left` is a
// strip of the window to keep clear (the legend panel), so no box opens hidden under it.
export function fitView(b: Bounds, vw: number, vh: number, left: number = 0): View | null {
  const spanX = b.maxX - b.minX;
  const spanY = b.maxY - b.minY;
  const w = vw - left;
  if (!isFinite(spanX) || !isFinite(spanY) || w < 50 || vh < 50 || spanX < 1 || spanY < 1) {
    return null;
  }
  const fit = Math.min((w - 2 * PAD) / spanX, (vh - 2 * PAD) / spanY);
  const zoom = clamp(fit, MIN_ZOOM, 1);
  const place = (span: number, size: number, min: number): number =>
    span * zoom <= size - 2 * PAD ? (size - span * zoom) / 2 - min * zoom : PAD - min * zoom;
  return { panX: left + place(spanX, w, b.minX), panY: place(spanY, vh, b.minY), zoom };
}

// Pixels a wheel event moves. Mice can report in lines or pages instead of pixels.
export function wheelPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 16; // lines
  if (deltaMode === 2) return delta * 600; // pages
  return delta;
}

// Zoom about the screen point (sx, sy): the point under the cursor stays under the cursor.
// `deltaY` is in pixels; a mouse notch (~100 px) zooms by about 18%, a trackpad pinch (a few
// pixels per event) zooms smoothly.
export function zoomAbout(v: View, sx: number, sy: number, deltaY: number): View {
  const zoom = clamp(v.zoom * Math.exp(-deltaY * 0.002), MIN_ZOOM, MAX_ZOOM);
  const wx = (sx - v.panX) / v.zoom;
  const wy = (sy - v.panY) / v.zoom;
  return { panX: sx - wx * zoom, panY: sy - wy * zoom, zoom };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
