/**
 * QR Code generator engine using qrcode-generator library.
 * Provides custom SVG rendering with multiple styles.
 */
import qrcode from 'qrcode-generator';

export type ECLevel = 'L' | 'M' | 'Q' | 'H';
export type QRStyle = 'square' | 'rounded' | 'dots';

export interface QRSvgOptions {
  text: string;
  errorCorrection: ECLevel;
  size: number;
  margin: number;
  foreground: string;
  background: string;
  style: QRStyle;
}

const EC_MAP: Record<ECLevel, Parameters<typeof qrcode>[0]> = {
  L: 'L',
  M: 'M',
  Q: 'Q',
  H: 'H',
};

export function getQRModules(text: string, ecLevel: ECLevel): boolean[][] {
  const qr = qrcode(0, EC_MAP[ecLevel]);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const modules: boolean[][] = [];
  for (let r = 0; r < count; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < count; c++) {
      row.push(qr.isDark(r, c));
    }
    modules.push(row);
  }
  return modules;
}

export function generateQRSvg(options: QRSvgOptions): string {
  const modules = getQRModules(options.text, options.errorCorrection);
  const moduleCount = modules.length;
  const cellSize = (options.size - options.margin * 2) / moduleCount;
  const totalSize = options.size;
  const offset = options.margin;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${totalSize}" height="${totalSize}" shape-rendering="crispEdges">`);
  parts.push(`<rect width="${totalSize}" height="${totalSize}" fill="${options.background}"/>`);

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (!modules[row][col]) continue;
      const x = offset + col * cellSize;
      const y = offset + row * cellSize;

      if (options.style === 'dots') {
        const cx = x + cellSize / 2;
        const cy = y + cellSize / 2;
        const r = cellSize * 0.38;
        parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${options.foreground}"/>`);
      } else if (options.style === 'rounded') {
        const rx = cellSize * 0.3;
        parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" rx="${rx.toFixed(2)}" fill="${options.foreground}"/>`);
      } else {
        parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="${options.foreground}"/>`);
      }
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

export function generateQRDataUrl(options: QRSvgOptions): string {
  const svg = generateQRSvg(options);
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

export function generateQRPngDataUrl(options: QRSvgOptions): Promise<string> {
  return new Promise((resolve) => {
    const svg = generateQRSvg(options);
    const img = new Image();
    const canvas = document.createElement('canvas');
    canvas.width = options.size;
    canvas.height = options.size;
    const ctx = canvas.getContext('2d')!;

    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  });
}
