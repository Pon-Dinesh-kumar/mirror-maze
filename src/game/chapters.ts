import { Mechanic } from './types';

export type ChapterId = 0 | 1 | 2 | 3 | 4;
export const LEVELS_PER_CHAPTER = 18;

export interface Chapter {
  id: ChapterId;
  number: number;
  title: string;
  world: string;
  heart: string;
  heartColor: string;
  intro: string[];
  /** World cleared: the road to the next world opens. */
  outro: string[];
  /** Every shard of this world gathered: its Heart is forged into the Amulet. */
  forge: string[];
  newMechanics: { icon: string; text: string }[];
  levels: [string, string][];
}

export const prologue = [
  'Long ago, the Great Prism carried light between five worlds.',
  'Five Hearts burned inside it: Sky, Life, Sun, Frost and Star.',
  'Then the Void opened its eye.',
  'The Prism shattered. Every world fell into shadow.',
  'One Lightkeeper remains. Gather every shard. Forge the Hearts anew.',
];

export const ending = [
  'The five Hearts burn as one.',
  'The Great Prism is whole again, and the Void closes its eye.',
  'Dawn returns to every world.',
  'Thank you, Lightkeeper.',
];

export const chapters: Chapter[] = [
  {
    id: 0, number: 1, title: 'The Fallen Sky', world: 'Sky Temples', heart: 'Sky Heart', heartColor: '#ff4fc3',
    intro: [
      'Above the clouds, the temples of the sky have gone cold.',
      'Their mirrors still remember how to bend the light.',
      'Wake the shrines. Find the Sky Heart.',
    ],
    outro: ['The temples of the sky are burning bright again.', 'Far below the clouds, a storm is waiting.'],
    forge: ['Every sky shard sings as one.', 'The Sky Heart is reborn.'],
    newMechanics: [
      { icon: 'sync', text: 'Tap mirrors to turn the light' },
      { icon: 'refresh-circle', text: 'Tap a sun lens to turn it a quarter turn' },
      { icon: 'cube', text: 'Stone blocks stop the beam' },
      { icon: 'sunny', text: 'Twin and triple suns' },
    ],
    levels: [
      ['First Light', 'A single mirror. A single spark. Every journey begins here.'],
      ['The Sun Lens', 'Tap the sun lens itself to turn it a quarter turn.'],
      ['The Turning', 'Turn the lens, then the mirror. Light listens to both.'],
      ['Stone Guardians', 'Old stones still stand in the light\'s way.'],
      ['The Unmoving', 'Some mirrors were set by the ancients. Leave them be.'],
      ['Cloud Steps', 'The first shrine stirs as light returns.'],
      ['Golden Passage', 'Gold paths once carried pilgrims here.'],
      ['Two Flames', 'Two crystals. One beam. Light them both.'],
      ['Shrine of Dawn', 'The first shrine awakens. The sky grows warmer.'],
      ['Echo Chamber', 'Light bounces like a song off the old walls.'],
      ['The Long Bridge', 'A bridge of light between two ruins.'],
      ['Hall of Mirrors', 'So many mirrors. Only some are true.'],
      ['Twin Suns', 'A second sun rises. Two lenses, twice the light.'],
      ['Star Altars', 'The altars wait for both beams at once.'],
      ['Shrine of Noon', 'Two lenses turn as one prayer.'],
      ['Triple Dawn', 'Three sun lenses wake together. Guide every beam.'],
      ['Gates of Heaven', 'The Heart is close. You can feel its warmth.'],
      ['The Sky Heart', 'Restore the Sky Heart!'],
    ],
  },
  {
    id: 1, number: 2, title: 'The Storm Canopy', world: 'Emerald Rainforest', heart: 'Life Heart', heartColor: '#3dff8a',
    intro: [
      'Beneath the clouds, a jungle drowns in an endless storm.',
      'Old totems sleep in the rain, their roots deep in the stone.',
      'Wake one, and the ground itself will turn. Find the Life Heart.',
    ],
    outro: ['The storm breaks. Life returns to the canopy.', 'The trail leads to the burning sands.'],
    forge: ['Every leaf and raindrop glows.', 'The Life Heart beats once more.'],
    newMechanics: [
      { icon: 'leaf', text: 'Tap a totem to wake it' },
      { icon: 'sync', text: 'Its glowing stones turn a quarter turn' },
      { icon: 'move', text: 'Everything on the stones turns with them' },
      { icon: 'hand-left', text: 'Hold a totem to see where they land' },
    ],
    levels: [
      ['The Waking Stones', 'Tap the carved totem. Its glowing stones turn a quarter turn.'],
      ['Under the Storm', 'A mirror rides the stones. Turn them, then turn it.'],
      ['Root Shrine', 'Watch where each stone will land before you wake the totem.'],
      ['Moss Temple', 'A stone blocks the road. The totem can carry it away.'],
      ['Firefly Hollow', 'Stone and mirror turn together. Plan for both.'],
      ['The Strangler Fig', 'One quarter turn, or two? Count before you wake it.'],
      ['Riding Light', 'The spirit idol stands on the stones. Its aim turns with them.'],
      ['Rain Shrine', 'The first rain shrine glows green.'],
      ['Serpent Stair', 'Move the idol and turn its aim in a single turn.'],
      ['Twin Totems', 'Two totems. Each turns only its own stones.'],
      ['Jaguar Stones', 'Carved jaguars guard the old road. Read each arrow.'],
      ['Knotted Grove', 'Every turn changes the road. Plan the whole path first.'],
      ['Locked Roots', 'One cluster stands in another\'s way. Clear its path first.'],
      ['Twin Springs', 'Two beams share the stones. Mend one, mind the other.'],
      ['Mist Falls', 'The order of the turns matters. Choose the first one well.'],
      ['Storm Eye', 'Three idols wake. The stones decide where each beam goes.'],
      ['Thunder King', 'The storm throws everything it has.'],
      ['The Life Heart', 'Restore the Life Heart!'],
    ],
  },
  {
    id: 2, number: 3, title: 'The Sinking Sun', world: 'Desert of Pyramids', heart: 'Sun Heart', heartColor: '#ffb21e',
    intro: [
      'In the desert, the pyramids guard the last sunlight.',
      'Ra\'s prisms split a single beam in two.',
      'But the sun is setting. Every move counts.',
    ],
    outro: ['The sun stands still over the pyramids.', 'Far to the north, the trail turns cold.'],
    forge: ['Ra gathers every ray of light.', 'The Sun Heart rises.'],
    newMechanics: [
      { icon: 'sunny', text: 'Light the solar seals to move the gates' },
      { icon: 'list', text: 'Wake numbered seals in order' },
      { icon: 'triangle', text: 'Prisms split the beam in two' },
      { icon: 'lock-open', text: 'A woken seal stays awake' },
    ],
    levels: [
      ['Solar Seal', 'Light the sun seal and its gate will open.'],
      ['Golden Dunes', 'The sand is warm, but the sun is sinking.'],
      ['Tomb Entrance', 'The tomb door is sealed with light.'],
      ['Prism of Ra', 'A prism splits one beam into two.'],
      ['Twin Rays', 'Two rays, two crystals. Ra smiles.'],
      ['Oasis Light', 'Water shimmers in the last sunlight.'],
      ['Seals of Order', 'Wake the seals in their numbered order.'],
      ['Scarab Hall', 'Golden scarabs guard the inner hall.'],
      ['The Sphinx\'s Riddle', 'The Sphinx asks: which seal comes first?'],
      ['Open Doors', 'A woken seal stays awake. Wake it, then turn the light away.'],
      ['Pharaoh\'s Gate', 'Only the patient may pass.'],
      ['Golden Chamber', 'Treasure gleams in the dark.'],
      ['Twin Pyramids', 'Two pyramids, two suns.'],
      ['Valley of Kings', 'The old kings rest beneath the sand.'],
      ['Eye of Horus', 'The eye sees every path.'],
      ['Three Suns', 'Three eyes of Ra open at once.'],
      ['Sunset Throne', 'The sun is almost gone.'],
      ['The Sun Heart', 'Restore the Sun Heart!'],
    ],
  },
  {
    id: 3, number: 4, title: 'The Frozen Echo', world: 'Ice Age', heart: 'Frost Heart', heartColor: '#6fe8ff',
    intro: [
      'Time stopped in the north. The world froze mid-breath.',
      'Ice-locked mirrors will not turn...',
      '...but the ice beneath them still drifts.',
    ],
    outro: ['The glaciers wake and the aurora returns.', 'Only the stars remain. And the Void.'],
    forge: ['The ice holds every shard of light.', 'The Frost Heart sings.'],
    newMechanics: [
      { icon: 'snow', text: 'Frozen mirrors never turn' },
      { icon: 'swap-horizontal', text: 'Tap one to glide it along its ice' },
      { icon: 'stop-circle', text: 'Floes stop against each other' },
      { icon: 'flashlight', text: 'Twin and triple frost lanterns' },
    ],
    levels: [
      ['Ice-Locked', 'This mirror is frozen in. Tap it to glide it along the ice.'],
      ['Frozen Silence', 'Snow falls without a sound.'],
      ['Drift Ice', 'Each floe glides until its ice runs out.'],
      ['Glacier Path', 'A floe stops against another. Park one in its way.'],
      ['The Ice Chain', 'One glide sets up the next.'],
      ['Mammoth Rest', 'Giants sleep beneath the snow.'],
      ['Floe Garden', 'Many floes, one road. Plan the order.'],
      ['Crystal Cave', 'The cave walls glitter like stars.'],
      ['Shrine of Frost', 'The first frost shrine shimmers awake.'],
      ['Thin Ice', 'Park a floe, then clear the road for the light.'],
      ['Frozen Falls', 'A waterfall stopped mid-fall.'],
      ['Echo Valley', 'Your footsteps answer from far away.'],
      ['Twin Lanterns', 'Two frost lanterns. Two beams. Plan every glide.'],
      ['Polar Night', 'Here the night lasts for months.'],
      ['Ice Bridge', 'A bridge of frozen light.'],
      ['Three Lanterns', 'Three frost lanterns. Three beams. One path each.'],
      ['The Last Winter', 'The Frost Heart is near.'],
      ['The Frost Heart', 'Restore the Frost Heart!'],
    ],
  },
  {
    id: 4, number: 5, title: 'Heart of the Void', world: 'The Void', heart: 'Star Heart', heartColor: '#b46bff',
    intro: [
      'Beyond the sky, the Void waits among dead stars.',
      'Wormholes fold space. Everything you learned will be tested.',
      'Light the Star Heart. Close the eye forever.',
    ],
    outro: ['The Void Eye flinches, but it will not close.', 'Only the five Hearts together can seal it.'],
    forge: ['The dead stars kindle, one by one.', 'The Star Heart burns brighter than the Void.'],
    newMechanics: [
      { icon: 'planet', text: 'The Devourer swallows stray light' },
      { icon: 'hand-left', text: 'Hold a piece to preview its light' },
      { icon: 'git-network', text: 'Wormholes bend space' },
    ],
    levels: [
      ['The Devourer', 'A hungry dark waits here. Never let the light fall in.'],
      ['Beyond the Sky', 'The air is gone. Only stars remain.'],
      ['Event Horizon', 'Do not stare into the dark.'],
      ['Wormhole', 'Light enters here and appears over there.'],
      ['Folded Space', 'Space bends like paper.'],
      ['Gravity Well', 'Everything here falls toward the dark.'],
      ['Moon Mirrors', 'Moons reflect the old light.'],
      ['Comet Trail', 'A comet races past.'],
      ['Nebula Gate', 'The first star gate opens.'],
      ['The Void Whispers', 'It knows you are coming.'],
      ['Star Seal', 'Even here, the old seals remember the sun.'],
      ['Asteroid Field', 'Rocks drift through the dark.'],
      ['Twin Stars', 'Two engines burn against the dark.'],
      ['Dark Matter', 'Something unseen bends the light.'],
      ['Starforge', 'Where stars are born.'],
      ['Triple Star', 'Three stars align against the dark.'],
      ['Into the Eye', 'There is no turning back.'],
      ['The Star Heart', 'Close the Void. Restore the Prism!'],
    ],
  },
];

export const mechanicTips: Partial<Record<Mechanic, string>> = {
  mirror: 'Tap a mirror to turn it. Light the crystal before your moves run out!',
  blocker: 'Stone blocks stop the light. Find a way around them.',
  fixed: 'Silver mirrors are fixed in place. Plan around them.',
  decoy: 'Not every mirror is part of the path.',
  multi: 'Light passes through crystals. Light them ALL!',
  totem: 'Tap a totem to turn its stones a quarter turn. Hold it to preview!',
  ride: 'Pieces on the stones turn with them: mirrors flip, idols re-aim.',
  totems: 'Each totem turns only its own stones. Read the arrows!',
  jam: 'Stones can\'t turn through anything. Clear their path first!',
  splitter: 'Prisms split the light into two beams!',
  limit: 'Every level has limited moves. Look first, then tap!',
  twin: 'Two cannons! Every crystal must be lit at the same time.',
  triple: 'Three cannons! Guide every beam to its own crystal.',
  turn: 'Tap a cannon to turn it a quarter turn. Its arrow shows its aim.',
  floe: 'Frozen mirrors never turn. Tap one to glide it along the ice!',
  stop: 'Floes stop against each other. Park one to halt another mid-track!',
  portal: 'Wormholes send the light out of their twin!',
  seal: 'Light a sun seal to move its gates. Numbered seals wake in order.',
  devourer: 'Light in the Devourer\'s zone is lost. Hold a piece to preview first!',
};

export const chapterOf = (levelId: number) => Math.floor((levelId - 1) / LEVELS_PER_CHAPTER) as ChapterId;
export const firstLevelOf = (chapter: number) => chapter * LEVELS_PER_CHAPTER + 1;
