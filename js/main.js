import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/* =====================================================================
   Config
   ===================================================================== */

const CONFIG = {
  bg: 0x050505,
  maxPixelRatio: 1.25,
  cameraStartZ: 9,
  cameraEndZ: -16.5,
  mouseStrength: { x: 0.06, y: 0.1 },
  lerp: { scroll: 0.075, mouse: 0.05 },
};

const isMobile = matchMedia('(max-width: 767px)').matches;

// Words floating in 3D space — camera flies through them on scroll.
const WORDS = [
  { text: 'ORBIS',             size: isMobile ? 2.6 : 4.2,  pos: [0, 1.1, 3.5],      rotY: 0,     baseOpacity: 0.42, range: [-0.02, 0.14] },
  { text: 'SCROLL TO EXPLORE', size: isMobile ? 0.5 : 0.62, pos: [isMobile ? 0 : -2.6, -0.4, 3.1], rotY: 0.25, baseOpacity: 0.3, range: [-0.02, 0.1] },
  { text: 'IMAGINE',           size: isMobile ? 1.7 : 2.6,  pos: [-1.6, 0.7, -2.4],  rotY: -0.35, baseOpacity: 0.38, range: [0.14, 0.42] },
  { text: 'CREATE',            size: isMobile ? 1.7 : 2.6,  pos: [0.8, 1.7, -7.2],   rotY: 0.2,   baseOpacity: 0.38, range: [0.42, 0.68] },
  { text: 'SHIP',              size: isMobile ? 1.7 : 2.6,  pos: [-0.9, 1.1, -12.2], rotY: -0.15, baseOpacity: 0.38, range: [0.68, 0.92] },
];

// Ambient chapters — synthesized pads crossfaded by scroll position.
const CHAPTERS = [
  { center: 0.07, width: 0.3, root: 110.0, color: 'dark'   }, // intro / imagine
  { center: 0.55, width: 0.28, root: 146.83, color: 'warm' }, // create
  { center: 0.92, width: 0.3, root: 196.0, color: 'bright' }, // ship
];

/* =====================================================================
   Texture helpers (everything procedural — no external assets)
   ===================================================================== */

function makeTextTexture(text, { fontSize = 220, weight = 400, letterSpacing = 0.06 } = {}) {
  // Space Age keeps its rounded, logo-matching letterforms in the lowercase
  // slots (a–z); the uppercase slots are a different style. Render lowercase.
  text = text.toLowerCase();
  const font = `${weight} ${fontSize}px "Space Age", "IBM Plex Mono", monospace`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const ls = fontSize * letterSpacing;
  const textW = probe.measureText(text).width + ls * Math.max(text.length - 1, 0);
  const pad = fontSize * 0.6;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(textW + pad * 2);
  canvas.height = Math.ceil(fontSize * 1.6);
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';

  let x = pad;
  const y = canvas.height / 2;
  for (const ch of text) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + ls;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: canvas.width / canvas.height };
}

function makeRadialTexture(stops, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// grayscale alphaMap: opaque center feathering to black at every edge, so a
// video plane dissolves into the scene instead of ending at a hard rectangle
function makeFeatherAlpha(w = 512, h = 288, inset = 0.16) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  const fx = w * inset, fy = h * inset;
  let g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(fx / w, 'rgba(0,0,0,1)');
  g.addColorStop(1 - fx / w, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(fy / h, 'rgba(0,0,0,1)');
  g.addColorStop(1 - fy / h, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // flatten the alpha feather into grayscale RGB (alphaMap reads the green channel)
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  return new THREE.CanvasTexture(canvas);
}

const makeDotTexture = () => makeRadialTexture([
  [0, 'rgba(255,255,255,1)'],
  [0.25, 'rgba(255,255,255,0.6)'],
  [1, 'rgba(255,255,255,0)'],
], 64);

const makeFogTexture = () => makeRadialTexture([
  [0, 'rgba(255,255,255,0.5)'],
  [0.4, 'rgba(255,255,255,0.18)'],
  [1, 'rgba(255,255,255,0)'],
], 512);

/* =====================================================================
   Scene
   ===================================================================== */

class Experience {
  constructor(container) {
    this.container = container;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.clock = new THREE.Clock();

    this.scrollProgress = 0;
    this.scrollTarget = 0;
    this.mouse = new THREE.Vector2();
    this.mouseTarget = new THREE.Vector2();

    this.initRenderer();
    this.initScene();
    this.initParticles();
    this.initFog();
    this.initVideoPanel();
    this.initPostFX();
    this.bindEvents();
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    this.renderer.setClearColor(CONFIG.bg, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
    this.renderer.setSize(this.width, this.height);
    this.container.appendChild(this.renderer.domElement);
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(CONFIG.bg, 0.045);
    this.camera = new THREE.PerspectiveCamera(50, this.width / this.height, 0.1, 100);
    this.camera.position.set(0, 0.8, CONFIG.cameraStartZ);
    this.cameraGroup = new THREE.Group();
    this.cameraGroup.add(this.camera);
    this.scene.add(this.cameraGroup);
  }

  initParticles() {
    // near-field dust scattered along the whole camera path
    const dustCount = isMobile ? 600 : 1400;
    const positions = new Float32Array(dustCount * 3);
    const spreadZ = CONFIG.cameraStartZ - CONFIG.cameraEndZ + 14;
    for (let i = 0; i < dustCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 26;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 2] = CONFIG.cameraStartZ + 5 - Math.random() * spreadZ;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      map: makeDotTexture(),
      size: 0.03,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this.dust);

    this.initMorphField();
    this.initTerrain();
  }

  // Particle mountain ranges that materialize grain-by-grain on the final
  // approach — a valley opens in the middle so the eclipse hangs above it.
  initTerrain() {
    const COLS = isMobile ? 150 : 250;
    const ROWS = isMobile ? 70 : 115;
    const count = COLS * ROWS;
    const X0 = -34, X1 = 34, Z0 = -48, Z1 = -9;

    const ph = Array.from({ length: 5 }, () => Math.random() * Math.PI * 2);
    const height = (x, z) => {
      const side = Math.min(1, Math.abs(x) / 9); // ridges climb close to the valley
      let h = Math.sin(x * 0.21 + ph[0]) * 1.1 + Math.sin(z * 0.17 + ph[1]) * 0.8;
      h += Math.sin(x * 0.07 + z * 0.11 + ph[2]) * 1.6;
      h += Math.sin(x * 0.45 + ph[3]) * 0.4 * Math.sin(z * 0.3 + ph[4]);
      return -2.2 + side * 2.4 + h * (0.22 + side * 0.78);
    };

    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count);
    const bright = new Float32Array(count);
    let i = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = X0 + (X1 - X0) * (c / (COLS - 1)) + (Math.random() - 0.5) * 0.22;
        const z = Z0 + (Z1 - Z0) * (r / (ROWS - 1)) + (Math.random() - 0.5) * 0.3;
        const y = height(x, z) + (Math.random() - 0.5) * 0.07;
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        rnd[i] = Math.random();
        // ridge crests glow brighter, like the moonlit peaks in the app
        bright[i] = THREE.MathUtils.clamp((y + 2.5) / 2.8, 0, 1) * 0.85 + Math.random() * 0.25;
        i++;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    geo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));

    this.terrainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uReveal: { value: 0 },
        uSize: { value: 3.0 },
        uResolution: { value: new THREE.Vector2(this.width, this.height) },
        uColor: { value: new THREE.Color(0xc9d2df) },
      },
      vertexShader: /* glsl */ `
        attribute float aRnd;
        attribute float aBright;
        uniform float uTime;
        uniform float uReveal;
        uniform float uSize;
        uniform vec2 uResolution;
        varying float vAlpha;

        void main() {
          // each grain settles in at its own moment, rising into place
          float reveal = smoothstep(aRnd * 0.6, aRnd * 0.6 + 0.4, uReveal);
          vec3 p = position;
          p.y -= (1.0 - reveal) * 1.8;
          p.y += sin(uTime * 0.5 + aRnd * 40.0) * 0.018;

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = max(-mv.z, 0.5);
          gl_PointSize = clamp((0.5 + aRnd) * uSize * (uResolution.y / 900.0) * (6.0 / dist), 0.6, 4.0);
          gl_Position = projectionMatrix * mv;

          float nearFade = smoothstep(0.5, 1.8, dist);
          vAlpha = reveal * aBright * nearFade;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;

        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float falloff = pow(1.0 - d * 2.0, 2.2);
          gl_FragColor = vec4(uColor, falloff * vAlpha * 0.8);
        }
      `,
    });

    this.terrain = new THREE.Points(geo, this.terrainMat);
    this.scene.add(this.terrain);
  }

  // One fine-grain particle field that morphs through four states as you
  // scroll: spiral galaxy sea → nebula cloud → orb → the Orbis eclipse logo.
  // All positions are baked in world space; the vertex shader blends between
  // them with a per-particle stagger so transitions stream, not snap.
  initMorphField() {
    const count = isMobile ? 5000 : 14000;

    const gauss = () => {
      let u = 0, v = 0;
      while (!u) u = Math.random();
      while (!v) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };

    const posGalaxy = new Float32Array(count * 3);
    const posCloud = new Float32Array(count * 3);
    const posOrb = new Float32Array(count * 3);
    const posLogo = new Float32Array(count * 3);
    const mixes = new Float32Array(count * 4); // heat per state: 0 white → .5 amber → 1 deep ember
    const sizes = new Float32Array(count);
    const rnds = new Float32Array(count);

    // --- state A: spiral galaxy, a tilted sea of stars below the typography
    {
      const R = 12, ARMS = 3;
      const tilt = new THREE.Euler(-0.5, 0, 0.14);
      const center = new THREE.Vector3(1.5, -1.8, -3.5);
      const v = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        const r = Math.pow(Math.random(), 1.7) * R;
        const t01 = r / R;
        const arm = ((i % ARMS) / ARMS) * Math.PI * 2;
        const angle = arm + Math.pow(t01, 0.75) * 4.4;
        const spread = 0.22 + t01 * 1.5;
        v.set(
          Math.cos(angle) * r + gauss() * spread,
          gauss() * (0.5 * Math.exp(-r * 0.3) + 0.05 + t01 * 0.18),
          Math.sin(angle) * r + gauss() * spread
        );
        v.applyEuler(tilt).add(center);
        posGalaxy[i * 3] = v.x;
        posGalaxy[i * 3 + 1] = v.y;
        posGalaxy[i * 3 + 2] = v.z;
        mixes[i * 4] = Math.exp(-t01 * 2.6) * 0.5 + Math.random() * 0.05;
      }
    }

    // --- state B: clumped nebula cloud around the IMAGINE chapter
    {
      // kept left of the flight path so the camera never wades through it
      const center = new THREE.Vector3(-3.4, 0.6, -3.0);
      const clumps = Array.from({ length: 7 }, () => new THREE.Vector3(
        center.x + (Math.random() - 0.5) * 5,
        center.y + (Math.random() - 0.5) * 2.4,
        center.z + (Math.random() - 0.5) * 4
      ));
      for (let i = 0; i < count; i++) {
        let x, y, z;
        if (Math.random() < 0.62) {
          const c = clumps[(Math.random() * clumps.length) | 0];
          x = c.x + gauss() * 0.95; y = c.y + gauss() * 0.7; z = c.z + gauss() * 0.95;
        } else {
          x = center.x + gauss() * 2.8; y = center.y + gauss() * 1.4; z = center.z + gauss() * 2.2;
        }
        posCloud[i * 3] = x; posCloud[i * 3 + 1] = y; posCloud[i * 3 + 2] = z;
        mixes[i * 4 + 1] = 0.04 + Math.random() * 0.08;
      }
    }

    // --- state C: a near-perfect orb (it is called Orbis) by the CREATE chapter
    {
      // deep enough that the camera beholds the whole sphere, never enters it
      const center = new THREE.Vector3(2.6, 0.9, -13.5);
      const R = 2.1;
      const GA = Math.PI * (3 - Math.sqrt(5)); // golden angle
      for (let i = 0; i < count; i++) {
        const y01 = 1 - (i / (count - 1)) * 2;
        const rad = Math.sqrt(1 - y01 * y01);
        const theta = GA * i;
        // gentle surface ripple + a hint of volume so it reads organic
        const ripple = 1 + 0.05 * Math.sin(theta * 3 + y01 * 5) + gauss() * 0.015;
        const rr = R * ripple * (Math.random() < 0.1 ? Math.random() * 0.9 : 1);
        posOrb[i * 3] = center.x + Math.cos(theta) * rad * rr;
        posOrb[i * 3 + 1] = center.y + y01 * rr;
        posOrb[i * 3 + 2] = center.z + Math.sin(theta) * rad * rr;
        mixes[i * 4 + 2] = 0.05 + Math.random() * 0.12;
      }
    }

    // --- state D: the Orbis eclipse, painted like the real thing —
    // a thin blazing rim hugging the black disc, wispy corona streamers
    // brushed outward at uneven lengths, and a faint halo breathing
    // between them. Embers continuously stream away from it (see shader).
    {
      const center = new THREE.Vector3(0, 1.85, -22);
      const R = 1.5;
      const RIM = 0.56; // black disc edge, as a fraction of R

      // brush strokes: a few grand streamers, many short tufts
      const streamers = Array.from({ length: 18 }, (_, k) => {
        const major = k < 4; // the long equatorial wisps
        return {
          angle: Math.random() * Math.PI * 2,
          len: major ? 0.7 + Math.random() * 0.85 : 0.12 + Math.random() * 0.35,
          width: 0.03 + Math.random() * (major ? 0.05 : 0.09),
          curve: (Math.random() - 0.5) * 0.9, // each stroke bends its own way
          tone: 0.75 + Math.random() * 0.5,   // per-stroke brightness variation
        };
      });

      for (let i = 0; i < count; i++) {
        let x, y, z, heat;
        const pick = i / count;

        if (pick < 0.42) {
          // the ring of fire: a thin, dense, blazing rim
          const a = Math.random() * Math.PI * 2;
          const rr = (RIM + Math.abs(gauss()) * 0.022) * R;
          x = Math.cos(a) * rr;
          y = Math.sin(a) * rr;
          z = gauss() * 0.04;
          heat = 0.3 + Math.random() * 0.18; // white-gold, fully bright
        } else if (pick < 0.88) {
          // corona streamers: particles brushed along each curved wisp,
          // dense at the base, scattering and cooling toward the tip
          const s = streamers[(Math.random() * streamers.length) | 0];
          const t = Math.pow(Math.random(), 1.7);
          const a = s.angle + s.curve * t * t + gauss() * s.width * (0.35 + t * 1.6);
          const rr = (RIM + 0.015 + t * s.len) * R;
          x = Math.cos(a) * rr;
          y = Math.sin(a) * rr;
          z = gauss() * (0.04 + t * 0.1);
          heat = Math.min(0.97, (0.45 + t * 0.5) / s.tone);
        } else {
          // faint halo breathing between the streamers
          const a = Math.random() * Math.PI * 2;
          const t = Math.pow(Math.random(), 2.4);
          const rr = (RIM + 0.03 + t * 0.75) * R;
          x = Math.cos(a) * rr;
          y = Math.sin(a) * rr;
          z = gauss() * 0.1;
          heat = 0.7 + Math.random() * 0.27;
        }

        posLogo[i * 3] = center.x + x;
        posLogo[i * 3 + 1] = center.y + y;
        posLogo[i * 3 + 2] = center.z + z;
        mixes[i * 4 + 3] = heat;
      }
    }

    for (let i = 0; i < count; i++) {
      sizes[i] = 0.35 + Math.pow(Math.random(), 3.5) * 2.4; // almost all fine grain, rare stars
      rnds[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posGalaxy, 3));
    geo.setAttribute('aPosB', new THREE.BufferAttribute(posCloud, 3));
    geo.setAttribute('aPosC', new THREE.BufferAttribute(posOrb, 3));
    geo.setAttribute('aPosD', new THREE.BufferAttribute(posLogo, 3));
    geo.setAttribute('aMixes', new THREE.BufferAttribute(mixes, 4));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnds, 1));

    this.morphMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uMorph: { value: 0 },
        uSize: { value: 5.0 },
        uResolution: { value: new THREE.Vector2(this.width, this.height) },
        uColorRim: { value: new THREE.Color(0xdde4ee) },   // cool white
        uColorAmber: { value: new THREE.Color(0xffc45c) }, // logo corona
        uColorDeep: { value: new THREE.Color(0xc64a10) },  // logo outer ember
        uLogoCenter: { value: new THREE.Vector2(0, 1.85) },
        uOpacity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aPosB;
        attribute vec3 aPosC;
        attribute vec3 aPosD;
        attribute vec4 aMixes;
        attribute float aSize;
        attribute float aRnd;
        uniform float uTime;
        uniform float uMorph;
        uniform float uSize;
        uniform vec2 uResolution;
        uniform vec2 uLogoCenter;
        varying float vRnd;
        varying float vHeat;
        varying float vDist;
        varying float vAway;

        void main() {
          // per-particle stagger so morphs stream like a flock, never snap
          float m = uMorph + (aRnd - 0.5) * 0.3;
          float s1 = smoothstep(0.0, 0.82, m);
          float s2 = smoothstep(1.0, 1.82, m);
          float s3 = smoothstep(2.0, 2.82, m);

          vec3 p = position;
          p = mix(p, aPosB, s1);
          p = mix(p, aPosC, s2);
          p = mix(p, aPosD, s3);

          float heat = aMixes.x;
          heat = mix(heat, aMixes.y, s1);
          heat = mix(heat, aMixes.z, s2);
          heat = mix(heat, aMixes.w, s3);

          // living drift — strongest as loose nebula, calmest once the logo locks
          float amp = mix(0.05, 0.17, s1);
          amp = mix(amp, 0.09, s2);
          amp = mix(amp, 0.025, s3);
          p += amp * vec3(
            sin(uTime * 0.42 + p.y * 1.3 + aRnd * 17.0),
            sin(uTime * 0.31 + p.x * 1.1 + aRnd * 11.0),
            sin(uTime * 0.26 + p.z * 1.2 + aRnd * 23.0)
          );

          // solar wind: once the eclipse forms, its embers stream away
          // from the disc and fade — hottest wisp tips escape fastest
          float awayGate = s3 * smoothstep(0.4, 0.65, aMixes.w);
          float flow = fract(uTime * 0.045 * (0.35 + aRnd) + aRnd * 7.0);
          vec2 dir = normalize(p.xy - uLogoCenter + vec2(0.0001));
          p.xy += dir * flow * 0.7 * awayGate;
          vAway = awayGate * flow;

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = max(-mv.z, 0.5);

          // rare bright points read as stars and gently flicker
          float star = smoothstep(2.0, 2.75, aSize);
          float flicker = 1.0 + star * 0.25 * sin(uTime * 1.8 + aRnd * 31.0);

          float size = aSize * flicker * uSize * (uResolution.y / 900.0);
          gl_PointSize = clamp(size * (6.0 / dist), 0.75, 16.0);
          gl_Position = projectionMatrix * mv;

          vRnd = aRnd;
          vHeat = heat;
          vDist = dist;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColorRim;
        uniform vec3 uColorAmber;
        uniform vec3 uColorDeep;
        uniform float uOpacity;
        varying float vRnd;
        varying float vHeat;
        varying float vDist;
        varying float vAway;

        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float falloff = pow(1.0 - d * 2.0, 2.6);
          // two-stop heat ramp: white → amber → deep ember
          vec3 col = mix(uColorRim, uColorAmber, clamp(vHeat * 2.0, 0.0, 1.0));
          col = mix(col, uColorDeep, clamp(vHeat * 2.0 - 1.0, 0.0, 1.0));
          // the outer corona thins away like the logo gradient
          float dim = 1.0 - smoothstep(0.5, 1.0, vHeat) * 0.6;
          // particles dissolve before they reach the lens — no near-camera blowups
          float nearFade = smoothstep(0.5, 1.9, vDist);
          // escaping embers cool and vanish as they travel
          float emberFade = 1.0 - vAway * 0.85;
          float alpha = falloff * (0.3 + vRnd * 0.45) * dim * nearFade * emberFade * uOpacity;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.morphField = new THREE.Points(geo, this.morphMat);
    this.scene.add(this.morphField);
  }

  initFog() {
    const tex = makeFogTexture();
    this.fogSprites = [];
    const count = isMobile ? 5 : 9;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0.02 + Math.random() * 0.025,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      const scale = 8 + Math.random() * 10;
      sprite.scale.set(scale, scale, 1);
      sprite.position.set(
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 6,
        CONFIG.cameraStartZ - 2 - Math.random() * (CONFIG.cameraStartZ - CONFIG.cameraEndZ + 6)
      );
      sprite.userData.speed = 0.02 + Math.random() * 0.05;
      sprite.userData.phase = Math.random() * Math.PI * 2;
      this.scene.add(sprite);
      this.fogSprites.push(sprite);
    }

    // low mist drifting over the valley floor at the finale
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0.035,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      const scale = 12 + Math.random() * 8;
      sprite.scale.set(scale, scale * 0.45, 1);
      sprite.position.set((Math.random() - 0.5) * 16, -1.6 - Math.random() * 0.6, -20 - Math.random() * 14);
      sprite.userData.speed = 0.02 + Math.random() * 0.03;
      sprite.userData.phase = Math.random() * Math.PI * 2;
      this.scene.add(sprite);
      this.fogSprites.push(sprite);
    }
  }

  async initWords() {
    await document.fonts.load('400 220px "Space Age"');
    this.words = WORDS.map((w) => {
      const { tex, aspect } = makeTextTexture(w.text);
      const h = w.size / aspect * (w.text.length > 10 ? 2.2 : 1.4);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w.size, h), mat);
      mesh.position.set(...w.pos);
      mesh.rotation.y = w.rotY;
      mesh.userData = w;
      this.scene.add(mesh);
      return mesh;
    });
  }

  // The product demo lives IN the 3D world — a video-textured plane placed
  // along the flight path at the CREATE beat. It gets the same perspective,
  // camera + mouse parallax, fog tint and fly-through dissolve as the words,
  // so it belongs to the scene instead of floating over it.
  initVideoPanel() {
    const video = document.createElement('video');
    video.src = 'assets/orbis-demo.mp4';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    // kept in the DOM (offscreen) so mobile browsers actually decode frames
    video.style.cssText = 'position:fixed;left:-9999px;top:0;width:16px;height:9px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);

    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const w = isMobile ? 3.7 : 6.0;
    const h = w * 9 / 16;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      alphaMap: makeFeatherAlpha(),
      transparent: true,
      opacity: 0,
      color: new THREE.Color(0xb0b0b0), // tame brightness so bloom doesn't blow it out
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true, // let the scene fog tint it with distance — key to merging
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const basePos = isMobile ? [0, 0.7, -8.6] : [-0.35, 0.85, -8.6];
    mesh.position.set(...basePos);
    mesh.rotation.y = 0.16; // angled in space, not flat-on to the lens
    this.scene.add(mesh);

    this.videoPanel = { mesh, video, basePos, range: [0.44, 0.74], baseOpacity: 0.95 };
  }

  initPostFX() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      0.9,   // strength
      0.85,  // radius
      0.08   // threshold — keep the void black, let type and motes glow
    );
    this.composer.addPass(this.bloom);
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('mousemove', (e) => {
      this.mouseTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseTarget.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
    this.renderer.setSize(this.width, this.height);
    this.composer.setSize(this.width, this.height);
    if (this.morphMat) this.morphMat.uniforms.uResolution.value.set(this.width, this.height);
    if (this.terrainMat) this.terrainMat.uniforms.uResolution.value.set(this.width, this.height);
  }

  setScroll(progress) {
    this.scrollTarget = progress;
  }

  // smoothstep-style reveal: 0 outside [start,end], eased plateau inside
  static rangeOpacity(p, [start, end], feather = 0.06) {
    const fadeIn = THREE.MathUtils.smoothstep(p, start - feather, start + feather);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(p, end - feather, end + feather);
    return fadeIn * fadeOut;
  }

  update() {
    const t = this.clock.getElapsedTime();

    this.scrollProgress += (this.scrollTarget - this.scrollProgress) * CONFIG.lerp.scroll;
    this.mouse.lerp(this.mouseTarget, CONFIG.lerp.mouse);

    // camera dolly through the scene
    const z = THREE.MathUtils.lerp(CONFIG.cameraStartZ, CONFIG.cameraEndZ, this.scrollProgress);
    this.camera.position.z = z;
    this.camera.position.x = Math.sin(this.scrollProgress * Math.PI * 1.5) * 0.8;
    this.camera.position.y = 0.8 + Math.sin(this.scrollProgress * Math.PI) * 0.5;
    // dip toward the valley on the final approach so the ground fills the frame
    this.camera.rotation.x = -0.11 * THREE.MathUtils.smoothstep(this.scrollProgress, 0.72, 0.96);

    // mouse parallax on a wrapper group, like the original's quickTo rotations
    this.cameraGroup.rotation.x += (this.mouse.y * CONFIG.mouseStrength.x - this.cameraGroup.rotation.x) * 0.06;
    this.cameraGroup.rotation.y += (-this.mouse.x * CONFIG.mouseStrength.y - this.cameraGroup.rotation.y) * 0.06;

    // word reveals tied to scroll ranges + a slow float;
    // words dissolve before the camera flies through them
    if (this.words) {
      for (const mesh of this.words) {
        const w = mesh.userData;
        const reveal = Experience.rangeOpacity(this.scrollProgress, w.range);
        const ahead = this.camera.position.z - mesh.position.z;
        const nearFade = THREE.MathUtils.smoothstep(ahead, 0.6, 2.2);
        mesh.material.opacity = w.baseOpacity * reveal * nearFade;
        mesh.position.y = w.pos[1] + Math.sin(t * 0.4 + w.pos[0]) * 0.06;
      }
    }

    // product demo plane — revealed over its scroll range, dissolving as the
    // camera flies through it, and only decoding video while it's visible
    if (this.videoPanel) {
      const vp = this.videoPanel;
      const reveal = Experience.rangeOpacity(this.scrollProgress, vp.range, 0.05);
      const ahead = this.camera.position.z - vp.mesh.position.z;
      const nearFade = THREE.MathUtils.smoothstep(ahead, 0.5, 2.6);
      const shown = reveal * nearFade;
      vp.mesh.material.opacity = vp.baseOpacity * shown;
      vp.mesh.position.y = vp.basePos[1] + Math.sin(t * 0.35) * 0.05;
      if (shown > 0.05 && vp.video.paused) vp.video.play().catch(() => {});
      else if (shown <= 0.05 && !vp.video.paused) vp.video.pause();
    }

    // drifting fog
    for (const s of this.fogSprites) {
      s.position.x += Math.sin(t * 0.1 + s.userData.phase) * 0.0015;
      s.position.y += Math.cos(t * 0.13 + s.userData.phase) * 0.001;
    }

    // slow dust breathing + morph state from scroll position:
    // galaxy (hero) → nebula (imagine) → orb (create) → eclipse logo (ship/outro)
    this.dust.rotation.z = Math.sin(t * 0.03) * 0.02;
    if (this.morphMat) {
      const p = this.scrollProgress;
      const ss = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);
      this.morphMat.uniforms.uMorph.value = ss(p, 0.16, 0.34) + ss(p, 0.44, 0.60) + ss(p, 0.68, 0.82);
      this.morphMat.uniforms.uTime.value = t;
    }

    // the ground gathers beneath you on the final approach to the eclipse
    if (this.terrainMat) {
      this.terrainMat.uniforms.uReveal.value = THREE.MathUtils.smoothstep(this.scrollProgress, 0.6, 0.93);
      this.terrainMat.uniforms.uTime.value = t;
    }

    this.composer.render();
  }
}

/* =====================================================================
   Audio — fully synthesized with Web Audio (no audio files)
   Ambient pad per chapter, crossfaded by scroll; hover blip on links.
   ===================================================================== */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.pads = [];
  }

  start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    // gentle fade-in after "enter"
    this.master.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 3);

    for (const ch of CHAPTERS) this.pads.push(this.createPad(ch));
    this.sun = this.createSunLayer();
  }

  // The "sun is near" layer: a radiant high shimmer over a deep solar
  // rumble — silent until the final approach to the eclipse.
  createSunLayer() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);

    // radiant shimmer: a bright detuned cluster, slowly beating
    const shimmerFreqs = [523.25, 659.25, 784.0]; // C5 E5 G5 — open, weightless
    for (const f of shimmerFreqs) {
      for (const d of [-4, 5]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f;
        osc.detune.value = d;
        const g = ctx.createGain();
        g.gain.value = 0.035;
        // each partial breathes at its own slow rate
        const trem = ctx.createOscillator();
        trem.frequency.value = 0.07 + Math.random() * 0.12;
        const tremGain = ctx.createGain();
        tremGain.gain.value = 0.02;
        trem.connect(tremGain);
        tremGain.connect(g.gain);
        trem.start();
        osc.connect(g);
        g.connect(out);
        osc.start();
      }
    }

    // solar mass: a deep slow rumble underneath
    const rumble = ctx.createOscillator();
    rumble.type = 'sine';
    rumble.frequency.value = 55;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.22;
    const rumbleLfo = ctx.createOscillator();
    rumbleLfo.frequency.value = 0.11;
    const rumbleLfoGain = ctx.createGain();
    rumbleLfoGain.gain.value = 0.08;
    rumbleLfo.connect(rumbleLfoGain);
    rumbleLfoGain.connect(rumbleGain.gain);
    rumbleLfo.start();
    rumble.connect(rumbleGain);
    rumbleGain.connect(out);
    rumble.start();

    // searing air: bright narrow noise, like heat hiss
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.12;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 3200;
    nf.Q.value = 4;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(out);
    noise.start();

    return { out };
  }

  createPad({ root, color }) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = color === 'bright' ? 900 : color === 'warm' ? 600 : 420;
    filter.Q.value = 0.7;
    filter.connect(out);

    // two detuned oscillators + a fifth, very quiet
    const detunes = [-7, 6];
    for (const d of detunes) {
      const osc = ctx.createOscillator();
      osc.type = color === 'dark' ? 'sine' : 'triangle';
      osc.frequency.value = root;
      osc.detune.value = d;
      const g = ctx.createGain();
      g.gain.value = 0.16;
      osc.connect(g);
      g.connect(filter);
      osc.start();
    }
    const fifth = ctx.createOscillator();
    fifth.type = 'sine';
    fifth.frequency.value = root * 1.5;
    const fg = ctx.createGain();
    fg.gain.value = 0.05;
    fifth.connect(fg);
    fg.connect(filter);
    fifth.start();

    // filtered noise air
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.18;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = root * 8;
    nf.Q.value = 2.5;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(out);
    noise.start();

    // slow LFO breathing on the filter
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06 + Math.random() * 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = filter.frequency.value * 0.35;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    return { out };
  }

  // crossfade pads by gaussian weight around each chapter center;
  // as the eclipse nears, the sun layer swells and the pads make way
  setProgress(p) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const x = THREE.MathUtils.clamp((p - 0.74) / (0.96 - 0.74), 0, 1);
    const sunNear = x * x * (3 - 2 * x);
    CHAPTERS.forEach((ch, i) => {
      const d = (p - ch.center) / ch.width;
      const weight = Math.exp(-d * d * 2.2);
      this.pads[i].out.gain.setTargetAtTime(weight * 0.55 * (1 - sunNear * 0.6), t, 0.4);
    });
    if (this.sun) this.sun.out.gain.setTargetAtTime(sunNear * 0.5, t, 0.6);
  }

  blip() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1320;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  toggle() {
    if (!this.ctx) return this.muted;
    this.muted = !this.muted;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, t, 0.25);
    return this.muted;
  }
}

/* =====================================================================
   Boot
   ===================================================================== */

const loaderEl = document.querySelector('.loader');
const loaderPct = document.querySelector('.js-loader-pct');
const loaderBar = document.querySelector('.js-loader-bar');
const enterBtn = document.querySelector('.js-enter');
const canvasEl = document.querySelector('.js-canvas');
const audioToggle = document.querySelector('.js-audio-toggle');
const waveEl = document.querySelector('.js-audio-wave');
const captions = [...document.querySelectorAll('.js-caption')];

const experience = new Experience(canvasEl);
const audio = new AudioEngine();

// ---- loading sequence: real work (fonts + first textures), eased counter
let displayed = 0;
let realProgress = 0;
const tickLoader = () => {
  displayed += (realProgress - displayed) * 0.08;
  const v = Math.round(displayed);
  loaderPct.textContent = v;
  loaderBar.style.transform = `scaleX(${displayed / 100})`;
  if (displayed > 99.5 && realProgress === 100) {
    loaderPct.textContent = 100;
    loaderEl.classList.add('is-ready');
    return;
  }
  requestAnimationFrame(tickLoader);
};
requestAnimationFrame(tickLoader);

(async () => {
  realProgress = 30;
  await experience.initWords();
  realProgress = 100;
})();

// ---- smooth scroll
const lenis = new Lenis({ duration: 1.6, smoothWheel: true });
function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);
lenis.stop(); // locked until "enter"

let progress = 0;
lenis.on('scroll', () => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  progress = max > 0 ? lenis.scroll / max : 0;
});

// ---- enter gate
enterBtn.addEventListener('click', () => {
  loaderEl.classList.add('is-hidden');
  document.body.classList.add('is-entered');
  audio.start();
  lenis.start();
});

// ---- captions driven by scroll progress
function updateCaptions(p) {
  for (const c of captions) {
    const from = parseFloat(c.dataset.from);
    const to = parseFloat(c.dataset.to);
    const o = Experience.rangeOpacity(p, [from, to], 0.04);
    c.style.opacity = o.toFixed(3);
    // only let a caption's links/buttons receive clicks while it's actually on screen
    c.classList.toggle('is-active', o > 0.6);
  }
}

// ---- audio toggle + waveform animation
let waveT = 0;
const WAVE_X = [1, 2.14, 3.29, 4.43, 5.57, 6.71, 7.86, 9];
function updateWave() {
  waveT += audio.muted ? 0 : 0.08;
  const pts = WAVE_X.map((x, i) => {
    const amp = audio.muted ? 0 : 1.3;
    const y = 5 + Math.sin(waveT + i * 0.85) * amp * (0.4 + 0.6 * Math.sin(i / 7 * Math.PI));
    return `${x},${y.toFixed(2)}`;
  }).join(' ');
  waveEl.setAttribute('points', pts);
}

audioToggle.addEventListener('click', () => {
  const muted = audio.toggle();
  audioToggle.classList.toggle('is-muted', muted);
  audioToggle.setAttribute('aria-pressed', String(!muted));
  audioToggle.setAttribute('aria-label', muted ? 'Enable sound' : 'Disable sound');
});

// ---- header Download → glide down to the eclipse + download options
document.querySelector('.js-download').addEventListener('click', () => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  lenis.scrollTo(max, { duration: 3.2 });
});

// ---- hover blips
document.querySelectorAll('[data-hover]').forEach((el) => {
  el.addEventListener('mouseenter', () => audio.blip());
});

// ---- main loop
function loop() {
  experience.setScroll(progress);
  experience.update();
  updateCaptions(progress);
  audio.setProgress(progress);
  updateWave();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
