import { AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, LatheGeometry, LinearFilter, NormalBlending, RGBAFormat, ShaderMaterial, Vector2, Vector3 } from 'three';

/** One shared clock uniform advanced by <ShaderClock/>. */
export const time = { value: 0 };

const keptShaders = new Set<string>();
/**
 * Disposes a ShaderMaterial, except the first one of each shader, which is kept for the session. three keys a custom
 * shader's program by an id it drops when the last material using that shader goes; the next material then compiles a
 * fresh program (and the old one, kept alive by KeepShaders, leaks). Holding one material keeps the id, so every later
 * level reuses the compiled program.
 */
export function disposeShader(material: ShaderMaterial) {
  const code = material.vertexShader + material.fragmentShader;
  if (keptShaders.has(code)) material.dispose();
  else keptShaders.add(code);
}

function texture(size: number, alpha: (x: number, y: number) => number) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(Math.max(0, Math.min(1, alpha((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1))) * 255);
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  // A DataTexture samples its nearest texel by default; glows are drawn many times larger than their texture (the
  // prologue's shatter flash fills the screen), which showed as a grid of hard-edged squares.
  t.magFilter = t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}
export const glowTexture = texture(64, (x, y) => Math.pow(Math.max(0, 1 - Math.hypot(x, y)), 2.2));
export const sparkTexture = texture(64, (x, y) => {
  const r = Math.hypot(x, y);
  const core = Math.pow(Math.max(0, 1 - r * 2.2), 2);
  const rays = Math.max(0, 1 - Math.abs(x) * 14) * Math.max(0, 1 - Math.abs(y)) + Math.max(0, 1 - Math.abs(y) * 14) * Math.max(0, 1 - Math.abs(x));
  return core + rays * .9;
});
let cseed = 3;
const crand = () => { cseed = (cseed * 16807) % 2147483647; return cseed / 2147483647; };
const blobs = Array.from({ length: 18 }, () => ({ x: (crand() - .5) * 1.1, y: (crand() - .5) * .5 + .05, r: .22 + crand() * .3 }));
export const cloudTexture = texture(128, (x, y) => {
  let v = 0;
  for (const b of blobs) v += Math.exp(-((x - b.x) ** 2 + ((y - b.y) * 1.6) ** 2) / (b.r * b.r));
  return Math.min(1, v * .55) * Math.max(0, 1 - Math.hypot(x, y * 1.4) ** 3);
});

export function bakeAO(geometry: BufferGeometry, low = .55, power = 1.2) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - box.min.y) / (box.max.y - box.min.y || 1);
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = low + (1 - low) * Math.pow(t, power);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

const NOISE = /* glsl */`
float hash(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= .5; } return v; }`;
const UV_VERTEX = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export function skyMaterial() {
  return new ShaderMaterial({
    side: BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      uTime: time, uTop: { value: new Color() }, uHorizon: { value: new Color() }, uBottom: { value: new Color() },
      uSun: { value: new Color() }, uSunDir: { value: new Vector3() }, uSunSize: { value: 1 }, uStorm: { value: 0 },
      uNebula: { value: 0 }, uStars: { value: 0 }, uFlash: { value: 0 }, uDusk: { value: 0 },
    },
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uSunSize, uStorm, uNebula, uStars, uFlash, uDusk;
      uniform vec3 uTop, uHorizon, uBottom, uSun, uSunDir;
      varying vec3 vDir;
      ${NOISE}
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 top = mix(uTop, vec3(.12,.06,.22), uDusk), hor = mix(uHorizon, vec3(1.,.42,.22), uDusk);
        vec3 col = h > 0. ? mix(hor, top, pow(smoothstep(0., 1., h), .55)) : mix(hor, uBottom * (1. - uDusk * .5), smoothstep(0., .35, -h));
        vec3 sd3 = normalize(uSunDir - vec3(0., uDusk * .3, 0.));
        float sd = max(dot(d, sd3), 0.);
        col += uSun * (pow(sd, 900. / uSunSize) * 2.5 + pow(sd, 14.) * .4 + pow(sd, 3.) * .12) * (1. - uDusk * .4);
        if (uStorm > 0.) {
          float n = fbm(d * 3. + vec3(uTime * .03, 0., uTime * .02));
          col = mix(col, col * .5 + vec3(.03,.05,.05), uStorm * smoothstep(.3, .75, n) * smoothstep(-.1, .25, h));
        }
        if (uNebula > 0.) {
          float n = fbm(d * 2.2 + vec3(uTime * .004));
          float m = fbm(d * 4.5 + 7.);
          col += uNebula * (vec3(.45,.06,.6) * pow(smoothstep(.45, .95, n), 1.6) * 1.2 + vec3(.06,.22,.75) * pow(smoothstep(.5, .95, m), 1.5) * .9 + vec3(1.,.35,.55) * pow(smoothstep(.6, .92, n * m * 1.7), 2.) * .9);
        }
        if (uStars > 0.) {
          vec3 g = floor(d * 900.); float s = hash(g);
          col += uStars * smoothstep(.9988, 1., s) * 1.6 * (.6 + .4 * sin(uTime * 2. + s * 90.)) * smoothstep(-.05, .2, h + uNebula);
        }
        col += uFlash * vec3(.7, .78, 1.);
        gl_FragColor = vec4(col, 1.);
      }`,
  });
}

export const glassMaterial = new ShaderMaterial({
  uniforms: { uTime: time, uLit: { value: 0 } },
  vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`
    uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){
      float fres = pow(1. - abs(dot(vN, vV)), 2.);
      vec3 c = mix(vec3(.04,.22,.42), vec3(.55,.85,1.0), smoothstep(.0, 1., vUv.y + fres * .4));
      float d = vUv.x + vUv.y;
      float sweep = fract(uTime * .22) * 3.4 - .6;
      c += vec3(smoothstep(.06, .0, abs(d - .62)) * .35 + smoothstep(.03, .0, abs(d - .8)) * .3 + smoothstep(.14, .0, abs(d - sweep)) * .6);
      c += fres * vec3(.6, .85, 1.) * .5;
      gl_FragColor = vec4(c, 1.0);
    }`,
});

export const waterMaterial = new ShaderMaterial({
  uniforms: { uTime: time }, vertexShader: UV_VERTEX, transparent: true, depthWrite: false, side: DoubleSide,
  fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv;
    void main(){ float s = fract(vUv.y * 4.0 + uTime * 1.6 + sin(vUv.x * 18.0) * .08);
      vec3 c = mix(vec3(.6,.86,1.0), vec3(1.0), smoothstep(.55, 1.0, s));
      gl_FragColor = vec4(c, .85 * smoothstep(.0,.2,vUv.x) * smoothstep(1.0,.8,vUv.x) * smoothstep(.0,.25,vUv.y)); }`,
});

export const portalMaterial = new ShaderMaterial({
  uniforms: { uTime: time }, vertexShader: UV_VERTEX, transparent: true, depthWrite: false, side: DoubleSide,
  fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv;
    void main(){ vec2 p = vUv - .5; float r = length(p); float a = atan(p.y, p.x);
      float sw = sin(a * 3.0 + r * 24.0 - uTime * 6.0) * .5 + .5;
      vec3 c = mix(vec3(.3,.05,.85), vec3(1.0,.7,1.0), sw) + vec3(.7,.5,1.0) * smoothstep(.2,.0,r) * 1.5;
      gl_FragColor = vec4(c, smoothstep(.5,.34,r)); }`,
});

export function auroraMaterial(color1: string, color2: string) {
  return new ShaderMaterial({
    uniforms: { uTime: time, uA: { value: new Color(color1) }, uB: { value: new Color(color2) } },
    vertexShader: UV_VERTEX, transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending, fog: false,
    fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uA, uB; varying vec2 vUv;
      ${NOISE}
      void main(){ float n = fbm(vec3(vUv.x * 6. + uTime * .08, vUv.y * .5, uTime * .05));
        float curtain = smoothstep(.3, .7, n) * smoothstep(0., .25, vUv.y) * smoothstep(1., .45, vUv.y);
        float rays = .6 + .4 * sin(vUv.x * 120. + n * 20.);
        gl_FragColor = vec4(mix(uA, uB, vUv.y) * curtain * rays * 1.4, 1.); }`,
  });
}

type Rgb = [number, number, number];
/**
 * An accretion disc: hot `inner` gas swirling out into cooler `outer` gas, as raw shader colours (the Void Eye's is
 * orange into violet).
 */
export function diskMaterial(inner: Rgb = [1, .55, .2], outer: Rgb = [.7, .2, 1]) {
  return new ShaderMaterial({
    uniforms: { uTime: time, uPulse: { value: 0 }, uInner: { value: new Vector3(...inner) }, uOuter: { value: new Vector3(...outer) } }, vertexShader: UV_VERTEX,
    transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending, fog: false,
    fragmentShader: /* glsl */`uniform float uTime, uPulse; uniform vec3 uInner, uOuter; varying vec2 vUv;
      ${NOISE}
      void main(){ vec2 p = vUv - .5; float r = length(p) * 2.; float a = atan(p.y, p.x);
        float swirl = fbm(vec3(a * 2. + r * 6. - uTime * .6, r * 4., uTime * .1));
        float ring = smoothstep(.38, .5, r) * smoothstep(1., .55, r);
        vec3 c = mix(uInner, uOuter, smoothstep(.45, .95, r)) * (.5 + swirl * 1.3) * ring * (1. + uPulse);
        gl_FragColor = vec4(c, 1.); }`,
  });
}

/**
 * The Devourer's hold on the light, shared by every beam ribbon on a board: a black hole at `hole` (board coordinates)
 * bends the light toward itself (`pull` 0-1, falling off over `reach` tiles) and drinks it from the source end (`drain`:
 * path distance below which the light is gone). At rest pull and drain are 0 and the beams are untouched.
 */
export interface Abyss { hole: { value: Vector3 }; pull: { value: number }; reach: { value: number }; drain: { value: number } }

/**
 * Camera-facing energy ribbon for one beam segment. It reveals along the light's path distance (uReveal),
 * streams energy toward the beam's end, and takes on a per-world personality through uStyle.
 */
export function beamMaterial(glow: string, core: string, style: number, reveal: { value: number }, boost: { value: number }, abyss: Abyss) {
  return new ShaderMaterial({
    uniforms: {
      uTime: time, uReveal: reveal, uBoost: boost, uGlow: { value: new Color(glow) }, uCore: { value: new Color(core) },
      uStyle: { value: style }, uA: { value: new Vector3() }, uB: { value: new Vector3() }, uStart: { value: 0 }, uLength: { value: 1 },
      uFadeFrom: { value: 1e9 }, uWidth: { value: .5 },
      uHole: abyss.hole, uPull: abyss.pull, uReach: abyss.reach, uDrain: abyss.drain,
    },
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide,
    vertexShader: /* glsl */`
      uniform vec3 uA, uB, uHole; uniform float uStart, uLength, uWidth, uPull, uReach;
      varying vec2 vUv; varying float vAlong;
      void main(){
        float t = position.y + .5;
        vec4 va = modelViewMatrix * vec4(uA, 1.), vb = modelViewMatrix * vec4(uB, 1.);
        vec2 d = vb.xy - va.xy; d = length(d) < 1e-4 ? vec2(0., 1.) : normalize(d);
        vec4 v = mix(va, vb, t);
        // Bent toward the black hole: strongly near it, then, as its pull grows, everywhere.
        if (uPull > 0.) {
          float dh = distance(mix(uA, uB, t).xz, uHole.xz);
          v.xyz = mix(v.xyz, (modelViewMatrix * vec4(uHole, 1.)).xyz, uPull * .92 * exp(-dh * dh / (uReach * uReach)));
        }
        v.xy += vec2(-d.y, d.x) * position.x * uWidth;
        vUv = vec2(position.x + .5, t);
        vAlong = uStart + t * uLength;
        gl_Position = projectionMatrix * v;
      }`,
    fragmentShader: beamFragment(false),
  });
}

/**
 * A black hole's event horizon, drawn on a camera-facing quad: a disc that stays truly dark, a thin violet-magenta rim
 * with a white-hot inner edge, a faint lensed echo ring, and a gravitational ripple that runs outward now and then.
 * `uCore` is the dark disc's radius as a share of the quad (0-1), `uRim` the rim's brightness.
 */
export function horizonMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime: time, uCore: { value: .3 }, uRim: { value: 1 }, uRipple: { value: -1 } }, vertexShader: UV_VERTEX,
    transparent: true, depthWrite: false, toneMapped: false, fog: false,
    fragmentShader: /* glsl */`uniform float uTime, uCore, uRim, uRipple; varying vec2 vUv;
      void main(){
        float r = length(vUv - .5) * 2.;
        float a = atan(vUv.y - .5, vUv.x - .5);
        if (r > 1.) discard;
        float w = uCore * .1 + .012;
        // Gaussian bands written as exp(-q*q): pow() of a negative base is undefined in GLSL.
        float q = (r - uCore) / w, qe = (r - uCore * 1.45) / (w * 2.2), qr = (r - uCore - uRipple * (1. - uCore)) / .05;
        float rim = exp(-q * q) * (.8 + .2 * sin(a * 3. + uTime * 1.7));
        float echo = exp(-qe * qe) * .22;
        float ripple = uRipple >= 0. ? exp(-qr * qr) * (1. - uRipple) * .35 : 0.;
        vec3 violet = vec3(.62, .22, 1.), magenta = vec3(1., .3, .85), white = vec3(1., .92, 1.);
        vec3 col = mix(violet, magenta, .5 + .5 * sin(a + uTime * .6)) * (rim + echo + ripple) * uRim + white * pow(rim, 6.) * uRim;
        float glow = clamp((rim + echo + ripple) * uRim, 0., 1.);
        // Inside the rim the disc is opaque black: light never comes back out of it.
        float inside = 1. - smoothstep(uCore - w * .6, uCore, r);
        gl_FragColor = vec4(col * (1. - inside), max(inside, glow));
      }`,
  });
}

/**
 * The world going dark around a black hole: a full-screen veil in screen space. Darkness gathers around the hole
 * (`uCenter`, in clip space) and spreads outward with `uSpread`; `uWave` sends one last violet pulse across the screen.
 * One quad and one blend per pixel: far cheaper than dimming every light, material and particle one by one.
 */
export function veilMaterial() {
  return new ShaderMaterial({
    uniforms: { uCenter: { value: new Vector2() }, uAspect: { value: 1 }, uDark: { value: 0 }, uSpread: { value: 0 }, uWave: { value: 0 } },
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false,
    vertexShader: /* glsl */`varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: /* glsl */`uniform vec2 uCenter; uniform float uAspect, uDark, uSpread, uWave; varying vec2 vP;
      void main(){
        vec2 d = vP - uCenter; d.x *= uAspect;
        float r = length(d);
        float R = mix(.3, 2.6, uSpread);
        float shade = uDark * mix(1. - smoothstep(R * .35, R, r), 1., smoothstep(.55, 1., uSpread));
        float q = (r - uWave * 2.8) / .06;
        float ring = uWave > 0. ? exp(-q * q) * (1. - uWave) * .55 : 0.;
        gl_FragColor = vec4(vec3(.55, .28, 1.) * ring, clamp(max(shade, ring), 0., 1.));
      }`,
  });
}

/**
 * The projected route while the player holds a piece: a thin ribbon of light dashes marching along where the beam would
 * go after that tap. Same geometry as the gameplay beam, drawn faint so it never reads as the real light.
 */
export function ghostBeamMaterial(color: string) {
  return new ShaderMaterial({
    uniforms: {
      uTime: time, uColor: { value: new Color(color) }, uA: { value: new Vector3() }, uB: { value: new Vector3() }, uStart: { value: 0 },
      uLength: { value: 1 }, uWidth: { value: .3 },
    },
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide,
    vertexShader: /* glsl */`
      uniform vec3 uA, uB; uniform float uStart, uLength, uWidth;
      varying vec2 vUv; varying float vAlong;
      void main(){
        float t = position.y + .5;
        vec4 va = modelViewMatrix * vec4(uA, 1.), vb = modelViewMatrix * vec4(uB, 1.);
        vec2 d = vb.xy - va.xy; d = length(d) < 1e-4 ? vec2(0., 1.) : normalize(d);
        vec4 v = mix(va, vb, t);
        v.xy += vec2(-d.y, d.x) * position.x * uWidth;
        vUv = vec2(position.x + .5, t);
        vAlong = uStart + t * uLength;
        gl_Position = projectionMatrix * v;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying float vAlong;
      void main(){
        float x = (vUv.x - .5) * 2.;
        float dash = smoothstep(.5, .3, abs(fract(vAlong * 2.2 - uTime * 2.4) - .5));
        float glow = exp(-x * x * 9.);
        gl_FragColor = vec4(uColor * (.5 + dash), glow * (.22 + .5 * dash));
      }`,
  });
}

/**
 * The beam's look, shared by the gameplay beam and the journey map's laser paths so both are the same light. On the map
 * (`map`), the stretch beyond the furthest level reached is drawn as a faint dormant thread instead of nothing, and the
 * path flows through every island without the per-segment start and exit fades.
 */
function beamFragment(map: boolean) {
  return /* glsl */`
      uniform float uTime, uReveal, uBoost, uStyle${map ? ', uDormant' : ', uFadeFrom, uStart, uDrain'};
      uniform vec3 uGlow, uCore;
      varying vec2 vUv; varying float vAlong;
      ${NOISE}
      void main(){
        float a = vAlong;
        ${map ? /* glsl */`if (a > uReveal) {
          float dx = (vUv.x - .5) * 2.;
          float dash = smoothstep(.18, .0, abs(fract(a * 1.4 - uTime * .1) - .5) - .2);
          gl_FragColor = vec4(mix(uGlow, vec3(.75, .8, 1.), .55), exp(-dx * dx * 36.) * (.14 + .16 * dash) * uDormant);
          return;
        }` : /* glsl */`if (a > uReveal || a < uDrain) discard;`}
        float t = uTime;
        float x = (vUv.x - .5) * 2.;
        float energy = 1.;
        // 1 rain spirit: twin strands spiral around the core
        if (uStyle > .5 && uStyle < 1.5) x += sin(a * 7. - t * 9.) * .18;
        // 4 void plasma: the core crackles and jitters like an electric arc
        if (uStyle > 3.5) x += (noise(vec3(a * 5. - t * 18., t * 7., 0.)) - .5) * .5;
        float ax = abs(x);
        float core = exp(-ax * ax * 70.);
        float glow = exp(-ax * 3.4) * (1. - smoothstep(.75, 1., abs(vUv.x - .5) * 2.));
        float flow = .7 + .3 * sin(a * 8. - t * 20.);
        float n = noise(vec3(a * 3. - t * 6., x * 3., t * .7));
        if (uStyle < .5) { energy = .8 + .35 * sin(a * 3. - t * 6.) + .25 * flow; }                      // 0 sunbeam shimmer
        else if (uStyle < 1.5) { energy = .75 + .5 * smoothstep(.4, .9, n) + .2 * flow; }                // 1 rain spirit
        else if (uStyle < 2.5) { energy = .55 + 1.1 * fbm(vec3(a * 2.5 - t * 4., x * 2., t)) ; }       // 2 solar fire turbulence
        else if (uStyle < 3.5) { energy = .8 + .3 * flow + step(.985, hash(floor(vec3(a * 18. - t * 12., x * 6., 0.)))) * 3.; } // 3 frost glints
        else { energy = .7 + .7 * smoothstep(.55, .95, n) + .25 * flow; }                               // 4 plasma
        float head = smoothstep(.9, 0., uReveal - a);
        float fade = ${map ? '1.' : '1. - smoothstep(uFadeFrom, uFadeFrom + .7, a)'};
        float start = ${map ? '1.' : 'smoothstep(uStart - .01, uStart + .25, a) * .4 + .6'};
        // Being drunk by a black hole: the light ends in a white-hot front that runs on toward it.
        float front = ${map ? '0.' : 'uDrain > 0. ? exp(-(a - uDrain) * 2.5) : 0.'};
        vec3 col = uGlow * glow * energy * (1.1 + uBoost) + uCore * core * (1.4 + uBoost * 1.5) + uCore * head * glow * .8 + uCore * front * glow * 1.6;
        float alpha = clamp(glow * .85 + core, 0., 1.) * fade * start;
        gl_FragColor = vec4(col, alpha);
      }`;
}

/**
 * The journey map's laser path: every segment of a chapter in one mesh (one draw call), each quad carrying its own
 * endpoints, with exactly the gameplay beam's shading. `reveal` is how far along the path the light has reached.
 */
export function mapBeamMaterial(glow: string, core: string, style: number, reveal: { value: number }, width: number, under = false) {
  const m = new ShaderMaterial({
    uniforms: {
      uTime: time, uReveal: reveal, uBoost: { value: 0 }, uGlow: { value: new Color(glow) }, uCore: { value: new Color(core) },
      uStyle: { value: style }, uWidth: { value: width }, uDormant: { value: under ? 0 : 1 },
    },
    transparent: true, depthWrite: false, blending: under ? NormalBlending : AdditiveBlending, toneMapped: false, side: DoubleSide,
    vertexShader: /* glsl */`
      attribute vec3 aA, aB; attribute float aStart, aLength;
      uniform float uWidth;
      varying vec2 vUv; varying float vAlong;
      void main(){
        float t = position.y + .5;
        vec4 va = modelViewMatrix * vec4(aA, 1.), vb = modelViewMatrix * vec4(aB, 1.);
        vec2 d = vb.xy - va.xy; d = length(d) < 1e-4 ? vec2(0., 1.) : normalize(d);
        vec4 v = mix(va, vb, t);
        v.xy += vec2(-d.y, d.x) * position.x * uWidth;
        vUv = vec2(position.x + .5, t);
        vAlong = aStart + t * aLength;
        gl_Position = projectionMatrix * v;
      }`,
    fragmentShader: beamFragment(true),
  });
  return m;
}

/** Motes of light riding the lit part of the map's laser path, animated entirely on the GPU. */
export function mapRiderMaterial(color: string, reveal: { value: number }, size: number) {
  return new ShaderMaterial({
    uniforms: { uTime: time, uReveal: reveal, uColor: { value: new Color(color) }, uMap: { value: glowTexture }, uSize: { value: size }, uScale: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec3 aB; attribute float aStart, aLength, aPhase;
      uniform float uTime, uReveal, uSize, uScale; varying float vA;
      void main(){
        float f = fract(aPhase + uTime * (.35 + fract(aPhase * 7.) * .25) / max(aLength, .1));
        vec3 p = mix(position, aB, f);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vA = step(aStart + f * aLength, uReveal) * smoothstep(0., .12, f) * smoothstep(1., .88, f);
        gl_PointSize = uSize * uScale * (.7 + fract(aPhase * 13.) * .6) / max(.001, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`uniform sampler2D uMap; uniform vec3 uColor; varying float vA;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a * vA; if (a < .02) discard; gl_FragColor = vec4(uColor, a); }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  });
}

/** Island design units each map island bobs by. */
export const MAP_BOB = .045;
/**
 * Vertex snippet that gently floats each instanced map island: a slow sine whose phase comes from the instance's own
 * position, so neighbours drift out of step. Runs entirely on the GPU. Expects `uTime` and a `vec3 transformed`.
 */
export const mapBobGlsl = (amount = MAP_BOB) => /* glsl */`
  #ifdef USE_INSTANCING
    float mapPhase = instanceMatrix[3].x * 2.3 + instanceMatrix[3].y * 1.7;
  #else
    float mapPhase = 0.;
  #endif
  transformed.y += sin(uTime * .6 + mapPhase) * ${amount.toFixed(4)};`;

/** Flowing water for the map's instanced islands: follows each island's instance matrix and dims with its tint. */
export const mapWaterMaterial = new ShaderMaterial({
  uniforms: { uTime: time }, transparent: true, depthWrite: false, side: DoubleSide,
  vertexShader: /* glsl */`uniform float uTime; varying vec2 vUv; varying vec3 vTint;
    void main(){ vUv = uv; vec3 transformed = position;
      ${mapBobGlsl()}
      vec4 p = vec4(transformed, 1.);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vTint = instanceColor;
      #else
        vTint = vec3(1.);
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * p; }`,
  fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv; varying vec3 vTint;
    void main(){ float s = fract(vUv.y * 3.0 + uTime * 1.3 + sin(vUv.x * 14.0) * .08);
      vec3 c = mix(vec3(.62,.86,1.0), vec3(1.0), smoothstep(.55, 1.0, s)) * vTint;
      gl_FragColor = vec4(c, .82 * smoothstep(.0,.25,vUv.x) * smoothstep(1.0,.75,vUv.x) * smoothstep(1.0,.85,vUv.y) * smoothstep(.0,.3,vUv.y)); }`,
});

const gemProfile = [[0, -.62], [.3, -.12], [.4, .08], [.3, .5], [0, .92]].map(([x, y]) => new Vector2(x, y));
export const gemGeometry = new LatheGeometry(gemProfile, 6);
export const shardGeometry = new LatheGeometry([[0, -.3], [.12, -.05], [.1, .2], [0, .45]].map(([x, y]) => new Vector2(x, y)), 5);
export const heartGeometry = new LatheGeometry([[0, -.9], [.45, -.2], [.62, .15], [.5, .6], [0, 1.25]].map(([x, y]) => new Vector2(x, y)), 8);