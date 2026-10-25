import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapters, LEVELS_PER_CHAPTER } from './chapters';
import { levels } from './levels';
import { FIRST_CARD_BOTTOM, islandWidthFor, mapLayout } from './mapLayout';
import { islandParts, islandsReady, ISLAND_VARIANTS, prepareIslands } from '../world/map/islands';

for (const [width, height] of [[360, 740], [412, 915], [430, 932], [768, 1024]] as const) {
  test(`Journey map layout on a ${width}x${height} screen keeps every island on screen and in order`, () => {
    const layout = mapLayout(width, height);
    assert.equal(layout.sections.length, chapters.length);
    let previous = -Infinity;
    for (const l of levels) {
      const n = layout.node(l.id), w = layout.islandWidth(l.id);
      assert.ok(n.y > previous, `level ${l.id} is below level ${l.id - 1}`);
      previous = n.y;
      assert.ok(n.x - w / 2 >= 0 && n.x + w / 2 <= width, `level ${l.id} island fits the screen width`);
      const sec = layout.sections[l.chapter]!;
      assert.ok(n.y > sec.levelsTop && n.y < sec.levelsTop + sec.levelsH, `level ${l.id} sits in its chapter's band`);
      // Jumping to a level shows that level's world (worlds swap halfway through each gate).
      assert.equal(layout.chapterAt(layout.focusY(l.id)), l.chapter, `focusing level ${l.id} shows chapter ${l.chapter + 1}`);
    }
    // Focused on level 1, the first chapter's story card has scrolled fully off screen instead of showing under the header.
    assert.ok(layout.focusY(1) > FIRST_CARD_BOTTOM, `level 1 focus (${Math.round(layout.focusY(1))}) clears the story card`);
    // Scrolled to the very end, the last island sits comfortably on screen, above the footer.
    const lastOnScreen = previous - (layout.total - height);
    assert.ok(lastOnScreen > height * .25 && lastOnScreen < height * .65, `the Void Eye shows at ${Math.round(lastOnScreen / height * 100)}% of the screen at the end`);
    for (let c = 1; c < chapters.length; c++) {
      const prev = layout.sections[c - 1]!, sec = layout.sections[c]!;
      assert.equal(sec.gateTop, prev.levelsTop + prev.levelsH, 'chapters follow each other without gaps');
      // Islands on either side of a gate are never on screen while its world swaps (at the gate's middle).
      const swap = sec.gateTop + sec.gateH / 2;
      assert.ok(layout.node(c * LEVELS_PER_CHAPTER).y + 120 < swap - height / 2 || c === 0, `last island before gate ${c + 1} is off screen at the swap`);
      assert.ok(layout.node(c * LEVELS_PER_CHAPTER + 1).y - 120 > swap + height / 2, `first island after gate ${c + 1} is off screen at the swap`);
    }
  });
}

test('Chapter finales and the Void Eye get larger islands', () => {
  assert.equal(islandWidthFor(5), 186);
  assert.ok(islandWidthFor(18) > islandWidthFor(17));
  assert.ok(islandWidthFor(90) > islandWidthFor(72));
});

test('Islands can be built a little at a time in the background, ending with the same cached designs', () => {
  // Runs before any other test builds chapter 4's islands. A zero budget does one part per call.
  assert.equal(islandsReady(3), false);
  let calls = 0;
  while (!prepareIslands([3], 0)) calls++;
  assert.ok(calls > 40, `the work was split into ${calls} slices`);
  assert.equal(islandsReady(3), true);
  const parts = islandParts(3, 0);
  assert.ok(parts.solid.getAttribute('position').count > 500);
  assert.strictEqual(islandParts(3, 0), parts, 'finished designs are reused');
});

test('Every island design builds, with lit vertex colours and a modest vertex budget', () => {
  for (let c = 0; c < chapters.length; c++) {
    const designs: [number | 'boss', boolean][] = [...Array.from({ length: ISLAND_VARIANTS }, (_, v) => [v, false] as [number, boolean]), ['boss', c === chapters.length - 1]];
    for (const [design, finale] of designs) {
      const parts = islandParts(c, design, finale);
      const pos = parts.solid.getAttribute('position'), color = parts.solid.getAttribute('color'), normal = parts.solid.getAttribute('normal');
      assert.ok(pos && color && normal, `chapter ${c + 1} ${design}: solid has position, normal and colour`);
      assert.equal(color.count, pos.count);
      assert.ok(pos.count < 9000, `chapter ${c + 1} ${design}: ${pos.count} vertices stays light`);
      for (let i = 0; i < color.count; i += 7) assert.ok(Number.isFinite(color.getX(i)) && color.getX(i) >= 0, 'colours are valid');
      if (parts.water) assert.ok(parts.water.getAttribute('uv'), 'waterfalls carry UVs for the flowing water');
      assert.strictEqual(islandParts(c, design, finale), parts, 'designs are cached, not rebuilt');
    }
  }
});
