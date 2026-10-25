import { chapters, LEVELS_PER_CHAPTER } from './chapters';

/**
 * Shared, mutable map state written by the map screen and read by the 3D world every frame without React re-renders.
 * `y` is the scroll offset; the 3D layer draws at that offset and reports it through `onShown`, which the screen uses to
 * move its labels in the same frame, so labels and islands never drift apart. The screen also counts these reports and
 * shows its labels only once the islands are on screen.
 */
export interface MapScroll {
  /** How far through the current chapter's levels the view is (0..1); steers the background camera. */
  progress: number;
  y: number;
  onShown?: (y: number) => void;
  /** A just-earned unlock to animate: levels `from`..`to - 1` were cleared, `to` is newly reachable; `at` is in ms. */
  reveal?: { from: number; to: number; at: number };
}

/** Seconds of the unlock sequence: the cleared crystals pop, then the light travels to the newly reached island. */
export const REVEAL_POP = .55, REVEAL_TRAVEL = 1.25;

/** How far each island leans towards the viewer, so its top reads as a floating landscape. */
export const ISLAND_TILT = .52;
/** Island design units (top radius 1) per screen point, as a fraction of the island's width. */
export const islandScale = (width: number) => width * .43;

/** Vertical distance between consecutive level islands on the journey map, in screen points. */
export const MAP_STEP = 214;
/** Space above the first and below the last island of a chapter. */
export const MAP_PAD = 130;
/** How far down the first chapter's story card reaches, below the safe area. */
export const FIRST_CARD_BOTTOM = 560;

export interface MapSection { chapter: number; gateTop: number; gateH: number; levelsTop: number; levelsH: number }

export interface MapLayout {
  width: number;
  height: number;
  sections: MapSection[];
  /** Height of the whole scrollable map. */
  total: number;
  /** Centre of a level island (the top of its crystal dais), in map coordinates. */
  node(id: number): { x: number; y: number };
  /** On-screen width of a level island. */
  islandWidth(id: number): number;
  /** Scroll offset that puts a level a little below the middle of the screen. */
  focusY(id: number): number;
  /** The chapter whose world is shown at a scroll offset: worlds swap halfway through each gate. */
  chapterAt(y: number): number;
}

const LAST = chapters.length * LEVELS_PER_CHAPTER;

/** Island width for a level: chapter finales are larger and the Void Eye larger still. */
export const islandWidthFor = (id: number) => (id === LAST ? 236 : id % LEVELS_PER_CHAPTER === 0 ? 220 : 186);

/**
 * The journey map's geometry, shared by the scrolling UI and the 3D islands so both place every level at exactly the
 * same point. Each chapter is a tall gate (whose opaque middle hides the world swap) followed by its 18 islands, which
 * zig-zag like light bouncing between mirrors.
 */
export function mapLayout(width: number, height: number): MapLayout {
  const sections: MapSection[] = [];
  let y = 0;
  for (let c = 0; c < chapters.length; c++) {
    // The first gate is tall enough that its story card (which ends about FIRST_CARD_BOTTOM down) has scrolled fully
    // off screen when level 1 is in focus, so it never shows under the header.
    const gateH = c === 0 ? Math.round(FIRST_CARD_BOTTOM - MAP_PAD + height * .55 + 40) : Math.round(height * 1.75);
    const levelsH = (LEVELS_PER_CHAPTER - 1) * MAP_STEP + MAP_PAD * 2;
    sections.push({ chapter: c, gateTop: y, gateH, levelsTop: y + gateH, levelsH });
    y += gateH + levelsH;
  }
  const total = y + 320;
  const amp = Math.min(width * .22, 140);
  const node = (id: number) => {
    const c = Math.floor((id - 1) / LEVELS_PER_CHAPTER), i = (id - 1) % LEVELS_PER_CHAPTER;
    const sec = sections[c]!;
    // Larger finale islands are kept inside the screen on narrow phones.
    const half = islandWidthFor(id) / 2 + 6;
    const x = Math.min(width - half, Math.max(half, width / 2 + Math.sin(i * 1.05 + c * 1.3) * amp));
    return { x, y: sec.levelsTop + MAP_PAD + i * MAP_STEP };
  };
  return {
    width, height, sections, total, node, islandWidth: islandWidthFor,
    focusY: id => Math.max(0, Math.min(total - height, node(id).y - height * .55)),
    chapterAt: scrollY => {
      const mid = scrollY + height / 2;
      let c = 0;
      for (const sec of sections) if (sec.chapter > 0 && mid >= sec.gateTop + sec.gateH / 2) c = sec.chapter;
      return c;
    },
  };
}
