// Museum photographs come on a neutral studio backdrop. This keys the backdrop out at runtime so a statue can sit
// on any ground: sample the backdrop luminance along the edges, keep pixels that are darker than it by a margin or
// carry colour (bronze, marble warmth), and feather the matte with a light blur.
export function keyStatue(canvas: HTMLCanvasElement, src: string, onReady?: () => void) {
  const g = canvas.getContext("2d");
  if (!g) return;
  const im = new Image();
  im.decoding = "async";
  im.onload = () => {
    const w = im.naturalWidth, h = im.naturalHeight;
    canvas.width = w; canvas.height = h;
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, w, h), p = d.data;
    const lum = (i: number) => p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;
    let sum = 0, n = 0;
    const stepY = Math.max(1, h >> 5), stepX = Math.max(1, w >> 5);
    for (let y = 0; y < h; y += stepY) { sum += lum((y * w + 2) * 4) + lum((y * w + (w - 3)) * 4); n += 2; }
    for (let x = 0; x < w; x += stepX) { sum += lum((2 * w + x) * 4); n += 1; }
    const bg = sum / n;
    for (let i = 0; i < p.length; i += 4) {
      const L = lum(i);
      const sat = Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]);
      let k = Math.max(0, Math.min(1, (bg - L - 28) / 34));
      k = Math.max(k, Math.min(1, (sat - 10) / 26));
      p[i + 3] = Math.round(255 * k);
    }
    g.putImageData(d, 0, 0);
    g.globalCompositeOperation = "destination-in";
    g.filter = "blur(1.2px)";
    g.drawImage(canvas, 0, 0);
    g.filter = "none";
    g.globalCompositeOperation = "source-over";
    onReady?.();
  };
  im.src = src;
}
