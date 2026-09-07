import { ctx2d, newCanvas } from '../core/canvas';
import type { Store } from '../core/store';

/**
 * Opens the app on a real document rather than an empty shell, so the layer
 * stack, blend modes and eraser all have something to act on immediately.
 * Two layers, because one layer cannot demonstrate a blend mode.
 */
export function seedDocument(store: Store): void {
  const W = 760;
  const H = 500;

  const base = newCanvas(W, H);
  const c = ctx2d(base);
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1b3b52');
  g.addColorStop(0.55, '#3d6d6b');
  g.addColorStop(1, '#c98b3a');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  for (let i = 0; i < 2600; i++) {
    c.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    c.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  c.strokeStyle = 'rgba(10,12,16,.55)';
  c.lineWidth = 2;
  for (let y = 40; y < H; y += 46) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(W, y + 18);
    c.stroke();
  }

  store.doc.width = W;
  store.doc.height = H;
  const baseLayer = store.makeLayer(base, 'Example gradient', 'image');
  store.doc.layers.push(baseLayer);

  const glow = newCanvas(W, H);
  const gc = ctx2d(glow);
  const rg = gc.createRadialGradient(560, 150, 10, 560, 150, 230);
  rg.addColorStop(0, 'rgba(255,236,190,.95)');
  rg.addColorStop(0.4, 'rgba(255,170,60,.45)');
  rg.addColorStop(1, 'rgba(255,140,40,0)');
  gc.fillStyle = rg;
  gc.fillRect(0, 0, W, H);

  const glowLayer = store.makeLayer(glow, 'Example glow', 'paint');
  glowLayer.blend = 'lighter';
  store.doc.layers.push(glowLayer);

  store.doc.activeId = glowLayer.id;
  store.emit();
}
