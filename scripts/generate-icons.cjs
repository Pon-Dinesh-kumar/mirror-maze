// Usage: node scripts/generate-icons.cjs <icon-art.png>
// The app icon comes from square artwork; the splash keeps the vector lens art below.
const sharp = require('sharp');
const lens = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
 <radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff2c8" stop-opacity=".9"/><stop offset=".4" stop-color="#ffb43a" stop-opacity=".35"/><stop offset="1" stop-color="#ffb43a" stop-opacity="0"/></radialGradient>
 <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4cc"/><stop offset=".4" stop-color="#e6b85a"/><stop offset="1" stop-color="#8a5a1e"/></linearGradient>
 <linearGradient id="gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#cfe8ff"/><stop offset="1" stop-color="#8aa8ff"/></linearGradient>
</defs>
<circle cx="512" cy="500" r="420" fill="url(#halo)"/>
${['#ff4fc3','#3dff8a','#ffb21e','#6fe8ff','#b46bff'].map((c,i)=>{const a=(-30+i*15)*Math.PI/180;return `<line x1="560" y1="520" x2="${560+Math.cos(a)*420}" y2="${520+Math.sin(a)*420}" stroke="${c}" stroke-width="26" stroke-linecap="round" opacity=".95"/>`}).join('')}
<line x1="90" y1="560" x2="470" y2="520" stroke="#fff6d8" stroke-width="30" stroke-linecap="round"/>
<circle cx="512" cy="510" r="250" fill="none" stroke="url(#gold)" stroke-width="34"/>
<g transform="translate(512 500)">
 <polygon points="0,-190 125,-25 75,170 -75,170 -125,-25" fill="url(#gem)" stroke="#3a4a7a" stroke-width="10" stroke-linejoin="round"/>
 <polygon points="0,-190 45,-25 0,170 -45,-25" fill="#fff" opacity=".55"/>
 <polygon points="-125,-25 125,-25 0,10" fill="#fff" opacity=".7"/>
</g></svg>`;

// Push-pull fill: each transparent pixel takes the average colour of the visible pixels around it,
// read from ever finer downscales layered coarse to fine.
async function inpaint(rgba, size) {
  const level = async n => sharp(await sharp(rgba).resize(n, n).png().toBuffer()).resize(size, size, { kernel: 'mitchell' });
  let out = await (await level(1)).removeAlpha().png().toBuffer();
  for (let n = 2; n <= size / 4; n *= 2) out = await sharp(out).composite([{ input: await (await level(n)).png().toBuffer() }]).png().toBuffer();
  return sharp(out).composite([{ input: rgba }]).removeAlpha().png().toBuffer();
}

// The artwork is a rounded square on black. Replace the black corners with the surrounding
// sky/cloud colours so platform masks (iOS squircle, Android circle/squircle) never show a dark edge.
async function squareArt(file) {
  const { width } = await sharp(file).metadata();
  const s = width - 6; // drop the 1–2px dark line along the edges
  const rgb = await sharp(file).removeAlpha().extract({ left: 3, top: 3, width: s, height: s }).raw().toBuffer();
  const keep = new Uint8Array(s * s).fill(255), stack = [0, s - 1, s * (s - 1), s * s - 1];
  while (stack.length) {
    const i = stack.pop();
    if (!keep[i] || rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2] > 120) continue;
    keep[i] = 0;
    const x = i % s;
    if (x > 0) stack.push(i - 1);
    if (x < s - 1) stack.push(i + 1);
    if (i >= s) stack.push(i - s);
    if (i < s * (s - 1)) stack.push(i + s);
  }
  const raw = c => ({ raw: { width: s, height: s, channels: c } });
  const alpha = (await sharp(keep, raw(1)).blur(2).extractChannel(0).raw().toBuffer()).map(v => v > 250 ? 255 : 0); // cut ~4px past the black
  const art = await sharp(rgb, raw(3)).joinChannel(alpha, raw(1)).png().toBuffer();
  return inpaint(art, s);
}

(async () => {
  const square = await squareArt(process.argv[2]);
  await sharp(square).resize(1024, 1024, { kernel: 'lanczos3' }).png().toFile('assets/images/icon.png');
  // Adaptive foreground is 108dp but launchers show only the centre 72dp, so the art fills that 2/3
  // and its colours bleed out to the edge for the parallax/pulse margin.
  const art = await sharp(square).resize(684, 684, { kernel: 'lanczos3' }).toBuffer();
  const canvas = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, left: 170, top: 170 }]).png().toBuffer();
  await sharp(await inpaint(canvas, 1024)).png().toFile('assets/images/adaptive-foreground.png');
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#05030f' } }).png().toFile('assets/images/splash-bg.png');
  await sharp(Buffer.from(lens)).resize(512,512).png().toFile('assets/images/splash-icon.png');
  console.log('icons ok');
})();
