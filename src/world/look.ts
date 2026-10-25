// Visual identity of each chapter, shared by the 3D world and the UI.
export interface Look {
  sky: { top: string; horizon: string; bottom: string; sun: string; sunDir: [number, number, number]; sunSize: number; storm: number; nebula: number; stars: number };
  fog: { color: string; near: number; far: number };
  light: { sky: string; ground: string; hemi: number; sun: string; sunIntensity: number; fill: string; fillIntensity: number; exposure: number };
  tiles: string[];
  tileRoughness: number;
  foot: string[];
  crystal: string;
  crystalGlow: string;
  /** Outer glow colour of the light beam. */
  beam: string;
  /** Hot inner core colour of the light beam. */
  beamGlow: string;
  /** 0 sunbeam, 1 rain spirit, 2 solar fire, 3 aurora frost, 4 void plasma. */
  beamStyle: number;
  /** Name of the light source shown in tutorials. */
  source: string;
  frame: string;
  particles: string;
  ui: { primary: string; secondary: string; accent: string; title: [string, string, string]; titleStroke: string; panel: [string, string]; panelBorder: string; tint: string };
}

export const looks: Look[] = [
  { // Sky Temples: golden hour above a sea of clouds
    sky: { top: '#2f6fc4', horizon: '#ffd3a8', bottom: '#b4a2d4', sun: '#fff0c8', sunDir: [-.55, .22, -1], sunSize: 2.4, storm: 0, nebula: 0, stars: 0 },
    fog: { color: '#e9c8c6', near: 70, far: 300 },
    light: { sky: '#cfe6ff', ground: '#c89a8a', hemi: .75, sun: '#ffe2b8', sunIntensity: 2.6, fill: '#9fd0ff', fillIntensity: .5, exposure: .92 },
    tiles: ['#a8927e', '#9a836e', '#b49d86', '#8f7b6a', '#a38b74', '#bba48c'], tileRoughness: .85,
    foot: ['#8d7766', '#7e6b5e', '#977f6c'],
    crystal: '#ff4fc3', crystalGlow: '#ff3fb0', beam: '#ffb43a', beamGlow: '#fff6d8', beamStyle: 0, source: 'Sun Lens', frame: '#e8b04a', particles: '#ffe6b0',
    ui: { primary: 'green', secondary: 'blue', accent: '#ffd36a', title: ['#fffbe0', '#ffd34a', '#ff8a12'], titleStroke: '#5a2300', panel: ['#1d4f9ae6', '#0e2b62f0'], panelBorder: '#ffd36a', tint: '#0b2a6e' },
  },
  { // Emerald Rainforest: a drowned jungle under an endless storm
    sky: { top: '#16252a', horizon: '#4f6e66', bottom: '#1e2e28', sun: '#cfe8e0', sunDir: [.3, .5, -1], sunSize: 6, storm: 1, nebula: 0, stars: 0 },
    fog: { color: '#3a5249', near: 14, far: 80 },
    light: { sky: '#9cc4b6', ground: '#1f3128', hemi: .85, sun: '#d8ecff', sunIntensity: 1.35, fill: '#6fe0a8', fillIntensity: .4, exposure: 1.15 },
    tiles: ['#6f7b68', '#5f6c5a', '#7d8873', '#56634f', '#687a63', '#788470'], tileRoughness: .38,
    foot: ['#4c5646', '#434c3e', '#56614e'],
    crystal: '#3dff8a', crystalGlow: '#22e070', beam: '#22e6ff', beamGlow: '#e8ffff', beamStyle: 1, source: 'Spirit Idol', frame: '#c9a24a', particles: '#c8ff7a',
    ui: { primary: 'lime', secondary: 'teal', accent: '#b9ff6a', title: ['#f0ffe0', '#8fff6a', '#1fae4a'], titleStroke: '#0a3318', panel: ['#16543ce6', '#0a2a1ef0'], panelBorder: '#8fff6a', tint: '#0a3318' },
  },
  { // Desert of Pyramids: blazing sunset over endless dunes
    sky: { top: '#2a63c8', horizon: '#ffc27a', bottom: '#d88a4a', sun: '#fff1c0', sunDir: [.6, .16, -1], sunSize: 5, storm: 0, nebula: 0, stars: 0 },
    fog: { color: '#e9aa6e', near: 90, far: 320 },
    light: { sky: '#ffe2b8', ground: '#a0602a', hemi: .7, sun: '#ffd49a', sunIntensity: 3.3, fill: '#ff9a6a', fillIntensity: .5, exposure: .9 },
    tiles: ['#c99a5e', '#b88a52', '#d6a86a', '#ae7f4a', '#c4955a', '#dcb478'], tileRoughness: .9,
    foot: ['#b98a52', '#a97c48', '#c8975c'],
    crystal: '#ffb21e', crystalGlow: '#ff9a0a', beam: '#ff4a12', beamGlow: '#fff0b0', beamStyle: 2, source: 'Eye of Ra', frame: '#ffcf4a', particles: '#ffe1a0',
    ui: { primary: 'orange', secondary: 'sand', accent: '#ffcf4a', title: ['#fffbe0', '#ffcf4a', '#e86a10'], titleStroke: '#4a1c00', panel: ['#8a4a14e6', '#4a2208f0'], panelBorder: '#ffcf4a', tint: '#4a1c00' },
  },
  { // Ice Age: twilight glaciers under the aurora
    sky: { top: '#0a1838', horizon: '#3a7898', bottom: '#5a90b4', sun: '#d8f0ff', sunDir: [-.4, .08, -1], sunSize: 3, storm: 0, nebula: 0, stars: .7 },
    fog: { color: '#3f6f92', near: 50, far: 220 },
    light: { sky: '#cfe8ff', ground: '#2a4a6a', hemi: .75, sun: '#ffe8d0', sunIntensity: 2.2, fill: '#5affd0', fillIntensity: .6, exposure: .95 },
    tiles: ['#a9c4dc', '#98b6d0', '#b8d0e4', '#8aa8c4', '#a2bed8', '#c4daea'], tileRoughness: .25,
    foot: ['#6a8cac', '#5a7c9e', '#7a9cba'],
    crystal: '#6fe8ff', crystalGlow: '#38d0ff', beam: '#7a3cff', beamGlow: '#ffd6ff', beamStyle: 3, source: 'Frost Lantern', frame: '#cfe8ff', particles: '#ffffff',
    ui: { primary: 'ice', secondary: 'blue', accent: '#9ff0ff', title: ['#ffffff', '#bff4ff', '#3ab8ff'], titleStroke: '#062a4a', panel: ['#2a6a9ae6', '#0a2a4af0'], panelBorder: '#bff4ff', tint: '#062a4a' },
  },
  { // The Void: nebula, dead stars and the Void Eye
    sky: { top: '#05030f', horizon: '#1a0b33', bottom: '#05030f', sun: '#ff9a5a', sunDir: [0, .25, -1], sunSize: 1, storm: 0, nebula: 1, stars: 1 },
    fog: { color: '#120822', near: 80, far: 400 },
    light: { sky: '#9a8aff', ground: '#2a0a3a', hemi: .8, sun: '#e0e6ff', sunIntensity: 1.8, fill: '#ff4fd8', fillIntensity: .8, exposure: 1.1 },
    tiles: ['#3a3f52', '#33384a', '#41475c', '#2d3242', '#383d50', '#454b62'], tileRoughness: .35,
    foot: ['#22263a', '#1c2032', '#282d42'],
    crystal: '#b46bff', crystalGlow: '#a04bff', beam: '#ff2f8e', beamGlow: '#fff0fa', beamStyle: 4, source: 'Star Engine', frame: '#9ad8ff', particles: '#bfa8ff',
    ui: { primary: 'magenta', secondary: 'violet', accent: '#ff9ae8', title: ['#ffffff', '#e0a8ff', '#a03bff'], titleStroke: '#1e0640', panel: ['#3a1a7ae6', '#140a33f0'], panelBorder: '#e0a8ff', tint: '#1e0640' },
  },
];
