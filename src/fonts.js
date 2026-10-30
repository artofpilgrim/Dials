const base = import.meta.env?.BASE_URL ?? '/';
const face = (folder, file, weight) => ({
  url: `${base}fonts/${folder}/${encodeURIComponent(file)}`, weight,
});

export const FONTS = [
  { label: 'Helvetica', family: 'Helvetica, Arial, sans-serif', faces: [] },
  { label: 'Inter', family: 'Inter, sans-serif', faces: [face('inter', 'Inter.ttf', '100 900')] },
  { label: 'IBM Plex Mono', family: '"IBM Plex Mono", monospace', faces:
    ['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold']
      .map((name, i) => face('ibmplexmono', `IBMPlexMono-${name}.ttf`, (i + 1) * 100)) },
  { label: 'JetBrains Mono', family: '"JetBrains Mono", monospace', faces: [face('jetbrainsmono', 'JetBrainsMono.ttf', '100 800')] },
  { label: 'Space Mono', family: '"Space Mono", monospace', faces: [
    face('spacemono', 'SpaceMono-Regular.ttf', 400), face('spacemono', 'SpaceMono-Bold.ttf', 700),
  ] },
];
export const FONT_FAMILIES = FONTS.map(f => f.family);
export const FONT_BY_FAMILY = Object.fromEntries(FONTS.map(f => [f.family, f]));

export function fontFaceFor(family, weight = 400) {
  const faces = FONT_BY_FAMILY[family]?.faces ?? [];
  if (typeof faces[0]?.weight === 'string') return faces[0];
  // Follow CSS font matching, including its special 400–500 preference.
  const ascending = [...faces].sort((a, b) => a.weight - b.weight);
  if (weight >= 400 && weight <= 500) {
    return ascending.find(f => f.weight >= weight && f.weight <= 500)
      ?? ascending.filter(f => f.weight < weight).at(-1)
      ?? ascending.find(f => f.weight > 500);
  }
  if (weight < 400) return ascending.filter(f => f.weight <= weight).at(-1) ?? ascending[0];
  return ascending.find(f => f.weight >= weight) ?? ascending.at(-1);
}

export function fontCss(family, faces = FONT_BY_FAMILY[family]?.faces ?? []) {
  const name = family.split(',')[0].replaceAll('"', '');
  return faces.map(f => `@font-face{font-family:"${name}";src:url("${f.url}") format("truetype");font-weight:${f.weight};font-style:normal;font-display:block;}`).join('\n');
}

export function installFont(family) {
  const id = 'dials-fonts';
  let style = document.getElementById(id);
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = fontCss(family);
}

const buffers = new Map();
export async function loadFontBytes(url) {
  if (!buffers.has(url)) {
    const promise = fetch(url).then(response => {
      if (!response.ok) throw new Error('The selected font could not be loaded. Please try again.');
      return response.arrayBuffer();
    }).catch(error => { buffers.delete(url); throw error; });
    buffers.set(url, promise);
  }
  return buffers.get(url);
}
