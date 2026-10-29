// Small line icons, drawn here so the page needs no outside files.
const SVG_NS = 'http://www.w3.org/2000/svg';

const SHAPES = {
  chat: [['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }]],
  board: [['rect', { x: 3, y: 3, width: 5, height: 18, rx: 1 }], ['rect', { x: 10, y: 3, width: 5, height: 11, rx: 1 }], ['rect', { x: 17, y: 3, width: 4, height: 7, rx: 1 }]],
  brief: [['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }], ['path', { d: 'M14 3v5h5' }], ['path', { d: 'M9 13h6M9 17h6' }]],
  files: [['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }]],
  notes: [['path', { d: 'M12 20h9' }], ['path', { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' }]],
  preview: [['rect', { x: 3, y: 4, width: 18, height: 12, rx: 2 }], ['path', { d: 'M8 20h8M12 16v4' }]],
  tiles: [['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 }], ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }]],
  windows: [['rect', { x: 3, y: 5, width: 13, height: 11, rx: 2 }], ['path', { d: 'M8 19h11a2 2 0 0 0 2-2V9' }]],
  pop: [['path', { d: 'M15 3h6v6' }], ['path', { d: 'M10 14 21 3' }], ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }]],
  dockin: [['path', { d: 'M4 14h6v6' }], ['path', { d: 'M20 10h-6V4' }], ['path', { d: 'm14 10 7-7' }], ['path', { d: 'm3 21 7-7' }]],
  close: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  home: [['path', { d: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' }]],
  chevron: [['path', { d: 'm6 9 6 6 6-6' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  expand: [['path', { d: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' }]],
  shrink: [['path', { d: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7' }]],
  reset: [['path', { d: 'M3 12a9 9 0 1 0 3-6.7L3 8' }], ['path', { d: 'M3 3v5h5' }]],
};

export function icon(name, size = 18, weight = 1.8) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(weight));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attrs] of SHAPES[name] ?? []) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, String(value));
    svg.append(shape);
  }
  return svg;
}
