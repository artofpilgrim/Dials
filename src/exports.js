import { fontFaceFor, fontCss, loadFontBytes } from './fonts.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const parsedFonts = new Map();
const variations = new Map();

async function outlineFont(face, weight) {
  if (!parsedFonts.has(face.url)) {
    const promise = Promise.all([import('fontkit'), loadFontBytes(face.url)])
      .then(([module, bytes]) => module.create(new Uint8Array(bytes)))
      .catch(error => { parsedFonts.delete(face.url); throw error; });
    parsedFonts.set(face.url, promise);
  }
  const font = await parsedFonts.get(face.url);
  if (!Object.keys(font.variationAxes).length) return font;
  const key = `${face.url}:${weight}`;
  if (!variations.has(key)) variations.set(key, font.getVariation({ wght: weight, opsz: 14 }));
  return variations.get(key);
}

export async function outlineTextInSvg(svg, family) {
  const nodes = [...svg.querySelectorAll('text')];
  if (!nodes.length) return;
  if (!fontFaceFor(family)) throw new Error('Choose Inter, IBM Plex Mono, JetBrains Mono or Space Mono to outline text.');
  for (const node of nodes) {
    const text = node.textContent ?? '';
    const weight = Number(node.getAttribute('font-weight') || 400);
    const face = fontFaceFor(family, weight);
    const font = await outlineFont(face, weight);
    const size = Number(node.getAttribute('font-size') || 16);
    const scale = size / font.unitsPerEm;
    const run = font.layout(text);
    if (run.glyphs.some(glyph => glyph.id === 0)) throw new Error('The selected font cannot outline every character. Choose another font or disable outlining.');
    let x = Number(node.getAttribute('x') || 0) + Number(node.getAttribute('dx') || 0);
    let y = Number(node.getAttribute('y') || 0) + Number(node.getAttribute('dy') || 0);
    const advance = run.positions.reduce((width, position) => width + position.xAdvance, 0) * scale;
    const anchor = node.getAttribute('text-anchor');
    if (anchor === 'middle') x -= advance / 2;
    else if (anchor === 'end') x -= advance;
    const baseline = node.getAttribute('dominant-baseline');
    if (baseline === 'middle') y += (font.xHeight || font.unitsPerEm * 0.5) * scale / 2;
    else if (baseline === 'hanging') y += 0.8 * font.ascent * scale;
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('transform', `translate(${x} ${y}) scale(${scale} ${-scale})`);
    group.setAttribute('fill', node.getAttribute('fill') || '#000');
    let penX = 0, penY = 0;
    run.glyphs.forEach((glyph, i) => {
      const position = run.positions[i];
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', glyph.path.toSVG());
      path.setAttribute('transform', `translate(${penX + position.xOffset} ${penY + position.yOffset})`);
      group.appendChild(path);
      penX += position.xAdvance;
      penY += position.yAdvance;
    });
    node.replaceWith(group);
  }
}

async function embedFonts(svg, family) {
  const weights = [...new Set([...svg.querySelectorAll('text')].map(n => Number(n.getAttribute('font-weight') || 400)))];
  const faces = [...new Set(weights.map(w => fontFaceFor(family, w)).filter(Boolean))];
  if (!faces.length) return;
  const embedded = await Promise.all(faces.map(async face => {
    const bytes = new Uint8Array(await loadFontBytes(face.url));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { ...face, url: `data:font/ttf;base64,${btoa(binary)}` };
  }));
  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = fontCss(family, embedded);
  svg.appendChild(style);
}

export async function buildExportSvg(live, params) {
  if (!live) throw new Error('The preview is not ready yet.');
  const clone = live.cloneNode(true);
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', params.width);
  clone.setAttribute('height', params.height);
  clone.removeAttribute('style');
  clone.style.fontOpticalSizing = 'none';
  clone.style.fontSynthesis = 'none';
  if (params.outlineOnExport) await outlineTextInSvg(clone, params.fontFamily);
  else await embedFonts(clone, params.fontFamily);
  return clone;
}

export const serializeSvg = svg => '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pngDimensions(params) {
  const width = params.width * params.pngScale;
  const height = params.height * params.pngScale;
  // A conservative cross-browser budget, checked before any raster allocation.
  if (width > 16384 || height > 16384 || width * height > 16 * 1024 * 1024) {
    throw new Error('PNG exceeds 16 megapixels. Reduce the canvas size or PNG scale.');
  }
  return { width, height };
}

export async function rasterizeSvg(svg, params) {
  const { width, height } = pngDimensions(params);
  if (params.pngTransparent || params.bg === 'transparent') svg.querySelector('[data-background]')?.remove();
  const url = URL.createObjectURL(new Blob([serializeSvg(svg)], { type: 'image/svg+xml' }));
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The SVG could not be loaded for PNG export.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not create the PNG canvas. Try a smaller size.');
    context.drawImage(image, 0, 0, width, height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed. Try a smaller size.')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
