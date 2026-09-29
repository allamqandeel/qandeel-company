/**
 * The living Company Universe (three.js, WebGL 2). Geometry, light and atmosphere only: every word is in
 * the HTML label layer.
 *
 * What the eye learns without a click: the Founder at the centre (a small warm core with a thin seal ring,
 * never a sun), the CEO on the nearest orbit, one orbit per rank, one coloured, named rim arc per Department
 * sector, goals as beacons tethered to their Departments just outside the last orbit, and edges only where
 * live work relates two people.
 *
 * Two motion layers, kept apart by construction (C5 §7.2):
 * - AMBIENT LIFE — the atmosphere's slow light fields, the film grain, a few dust motes, the sector fields'
 *   breathing, the Founder halo and the pointer parallax. Neutral in colour, without direction between
 *   entities, never triggered by data, and removed entirely in reduced-motion mode. It cannot be mistaken
 *   for a company event because it never touches a node or an edge.
 * - SEMANTIC MOTION — camera focus / return, an edge pulse when a relation appears or changes, an attention
 *   item gliding inward when it is new, the selection ring, and the slow arc that circles a person whose
 *   work is running right now (a real state). In reduced-motion mode these become cuts and static marks:
 *   nothing disappears.
 */
import * as THREE from 'three';

import type { Emphasis, Layout, LayoutEdge, LayoutNode } from '../model/types.js';
import { departmentColor, nodeColor, nodeRadius, PALETTE, RELATION_COLORS, statusShape, type CameraTarget, type Projection, type RendererEvents, type UniverseRenderer } from './renderer.js';

const EASE_OUT = (t: number): number => 1 - Math.pow(1 - t, 3);
const EASE_IN_OUT = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const TAU = Math.PI * 2;

const BACKGROUND_VERT = `
out vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// A deep ink-to-haze gradient, two very slow, very large light fields (value noise) in a cool and a warm
// hue, a soft horizon band and film grain against banding: depth and atmosphere without a starfield and
// without neon. uDrift is 0 in reduced motion (a still gradient keeps the depth; the grain stays still).
const BACKGROUND_FRAG = `
precision highp float;
in vec3 vDir;
out vec4 fragColor;
uniform float uTime;
uniform float uDrift;
uniform vec3 uDeep;
uniform vec3 uHaze;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform vec3 uLook;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  vec3 d = vDir;
  float t = uTime * uDrift;
  float up = d.y * 0.5 + 0.5;
  vec3 base = mix(uDeep, uHaze, smoothstep(0.05, 0.95, up));
  float n1 = noise(d * 1.6 + vec3(t * 0.010, t * 0.006, 0.0));
  float n2 = noise(d * 3.2 - vec3(0.0, t * 0.012, t * 0.008));
  float field = smoothstep(0.42, 0.9, n1 * 0.72 + n2 * 0.28);
  float warmth = smoothstep(0.35, 0.95, noise(d * 1.1 + vec3(t * 0.004, 0.0, t * 0.003)));
  vec3 tint = mix(uCool, uWarm, warmth);
  vec3 color = base + tint * field * 0.34;
  // A faint horizon band below the orbit plane: the world has a floor, the orbits float above it.
  float horizon = exp(-pow((d.y + 0.18) * 5.0, 2.0)) * 0.09;
  color += uCool * horizon;
  // A broad, still pool of light where the camera looks (the company sits in it), fading to the edges.
  float pool = exp(-pow(distance(d, uLook) * 1.25, 2.0)) * 0.22;
  color += mix(uCool, uWarm, 0.3) * pool;
  float vignette = 1.0 - smoothstep(0.5, 1.4, length(vec2(d.x, d.z)) * 1.1);
  color *= 0.8 + 0.2 * vignette;
  float grain = (hash(vec3(gl_FragCoord.xy, floor(t * 6.0))) - 0.5) * 0.016;
  fragColor = vec4(color + grain, 1.0);
}`;

// The orbit plane: a soft table of light under the company, the orbit lines, alternating orbit bands, the
// sector fields (Department hue, stronger toward the rim), the named rim arcs and the thin sector separators —
// one anti-aliased shader instead of a stack of meshes, so the structure reads the same at every zoom.
const PLANE_VERT = `
out vec2 vPos;
void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PLANE_FRAG = `
precision highp float;
in vec2 vPos;
out vec4 fragColor;
uniform float uTime;
uniform float uBreath;
uniform float uCount;
uniform float uStart;
uniform float uGap;
uniform float uOuter;
uniform float uRim;
uniform float uRings[4];
uniform vec3 uColors[5];
uniform float uWeights[5];
uniform vec3 uPlane;
uniform vec3 uLine;
const float TAU = 6.28318530718;
float line(float d, float hw, float aa) { return 1.0 - smoothstep(hw, hw + aa, d); }
void main() {
  float r = length(vPos);
  float a = atan(vPos.y, vPos.x);
  float aa = fwidth(r) * 1.4 + 0.004;
  // Table of light: brightest under the Founder, gone past the goals.
  float table = pow(1.0 - smoothstep(0.0, uOuter + 1.5, r), 1.6);
  vec3 color = uPlane * table * 0.55;
  // Orbit bands: every second inter-ring band a touch lighter, so the rings read as steps, not stripes.
  float band = 0.0;
  if (r > uRings[0] && r < uRings[1]) band = 1.0;
  if (r > uRings[2] && r < uRings[3]) band = 1.0;
  color += uPlane * band * 0.06 * (1.0 - smoothstep(uRings[0], uRings[3], r) * 0.5);
  // Orbit lines: the CEO orbit slightly stronger than the outer ones.
  for (int i = 0; i < 4; i++) {
    float l = line(abs(r - uRings[i]), 0.012, aa);
    color += uLine * l * (i == 0 ? 0.55 : 0.34);
  }
  // Sectors.
  float span = (TAU - uGap) / max(uCount, 1.0);
  float rel = mod(a - uStart + TAU * 3.0, TAU);
  bool inGap = rel > TAU - uGap;
  if (!inGap) {
    float idx = floor(rel / span);
    float within = fract(rel / span);
    int i = int(idx);
    vec3 c = uColors[0]; float w = uWeights[0];
    if (i == 1) { c = uColors[1]; w = uWeights[1]; }
    if (i == 2) { c = uColors[2]; w = uWeights[2]; }
    if (i == 3) { c = uColors[3]; w = uWeights[3]; }
    if (i == 4) { c = uColors[4]; w = uWeights[4]; }
    float breath = 1.0 + uBreath * 0.06 * sin(uTime * 0.22 + idx * 1.3);
    float edge = smoothstep(0.0, 0.05, within) * smoothstep(0.0, 0.05, 1.0 - within);
    // The field: from the CEO orbit outward, gathering strength toward the rim, then gone.
    float field = smoothstep(uRings[0] + 0.3, uRim, r) * (1.0 - smoothstep(uRim, uRim + 0.9, r));
    color += c * field * edge * (0.07 + 0.09 * w) * breath;
    // The rim: a solid coloured arc that names the sector, with a small angular gap between neighbours.
    float rimGap = smoothstep(0.0, 0.025, within) * smoothstep(0.0, 0.025, 1.0 - within);
    float rim = line(abs(r - uRim), 0.075, aa) * rimGap;
    color += c * rim * (0.45 + 0.55 * w);
    // Separators: thin radial hairlines from the Director orbit to the rim.
    float toEdge = min(within, 1.0 - within) * span * r;
    float sep = line(toEdge, 0.008, aa) * smoothstep(uRings[1] - 0.6, uRings[1], r) * (1.0 - smoothstep(uRim - 0.2, uRim, r));
    color += uLine * sep * 0.22;
  }
  fragColor = vec4(color, 1.0);
}`;

interface NodeVisual {
  readonly node: LayoutNode;
  readonly group: THREE.Group;
  readonly core: THREE.Mesh;
  readonly ring: THREE.Object3D | null;
  readonly glow: THREE.Sprite;
  readonly runningArc: THREE.Mesh | null;
  readonly tethers: THREE.Mesh[];
  weight: number;
  arrive: { from: THREE.Vector3; started: number } | null;
}

interface EdgeVisual {
  readonly edge: LayoutEdge;
  readonly mesh: THREE.Mesh;
  readonly curve: THREE.QuadraticBezierCurve3;
  weight: number;
  pulse: THREE.Mesh | null;
  pulseStarted: number;
}

const CAMERA_DIR = new THREE.Vector3(0, 0.86, 0.94).normalize();

export class WebGlUniverse implements UniverseRenderer {
  readonly kind = 'webgl' as const;
  #renderer!: THREE.WebGLRenderer;
  #scene = new THREE.Scene();
  #camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  #container!: HTMLElement;
  #events!: RendererEvents;
  #nodes = new Map<string, NodeVisual>();
  #edges = new Map<string, EdgeVisual>();
  #world = new THREE.Group();
  #background!: THREE.Mesh;
  #plane!: THREE.Mesh;
  #motes!: THREE.Points;
  #founderHalo!: THREE.Sprite;
  #selectionRing!: THREE.Mesh;
  #layout: Layout | null = null;
  #reduced = false;
  #live = true;
  #raf = 0;
  #timer = new THREE.Timer();
  #pointer = new THREE.Vector2(0, 0);
  #parallax = new THREE.Vector2(0, 0);
  #ray = new THREE.Raycaster();
  #camFrom: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  #camTo = { pos: CAMERA_DIR.clone().multiplyScalar(34), look: new THREE.Vector3(0, 0, 0) };
  #camStart = 0;
  #camDuration = 0;
  #look = new THREE.Vector3(0, 0, 0);
  #glowTexture!: THREE.Texture;
  #shadowTexture!: THREE.Texture;
  #hovered: string | null = null;
  #disposed = false;
  #lastDistance = 0;
  #tmp = new THREE.Vector3();

  mount(container: HTMLElement, events: RendererEvents): void {
    this.#container = container;
    this.#events = events;
    this.#renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.0;
    this.#renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.#renderer.domElement);
    this.#scene.fog = new THREE.FogExp2(new THREE.Color(PALETTE.haze).getHex(), 0.011);
    this.#scene.add(this.#world);
    this.#glowTexture = makeRadialTexture([[0, 'rgba(255,255,255,0.9)'], [0.25, 'rgba(255,255,255,0.35)'], [0.6, 'rgba(255,255,255,0.08)'], [1, 'rgba(255,255,255,0)']]);
    this.#shadowTexture = makeRadialTexture([[0, 'rgba(0,0,0,0.55)'], [0.55, 'rgba(0,0,0,0.18)'], [1, 'rgba(0,0,0,0)']]);
    this.#buildAtmosphere();
    this.#camera.position.copy(this.#camTo.pos);
    this.#camera.lookAt(this.#camTo.look);
    container.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    container.addEventListener('pointerleave', () => this.#parallaxTarget(0, 0));
    container.addEventListener('click', (e) => this.#onClick(e));
    this.resize();
    this.#loop();
  }

  #buildAtmosphere(): void {
    const bgGeo = new THREE.SphereGeometry(180, 48, 32);
    const bgMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: BACKGROUND_VERT,
      fragmentShader: BACKGROUND_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: { value: 0 }, uDrift: { value: 1 }, uDeep: { value: new THREE.Color('#10142a') }, uHaze: { value: new THREE.Color('#2a3260') }, uWarm: { value: new THREE.Color('#8a5f4c') }, uCool: { value: new THREE.Color('#3866a4') }, uLook: { value: new THREE.Vector3(0, -0.68, -0.73) } },
    });
    this.#background = new THREE.Mesh(bgGeo, bgMat);
    this.#scene.add(this.#background);

    const planeGeo = new THREE.CircleGeometry(17.5, 128);
    const planeMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: PLANE_VERT,
      fragmentShader: PLANE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uBreath: { value: 1 },
        uCount: { value: 5 },
        uStart: { value: 0 },
        uGap: { value: 0.36 },
        uOuter: { value: 14 },
        uRim: { value: 12.1 },
        uRings: { value: [2.6, 5.3, 8.0, 10.7] },
        uColors: { value: Array.from({ length: 5 }, (_, i) => new THREE.Color(departmentColor(i))) },
        uWeights: { value: [1, 1, 1, 1, 1] },
        uPlane: { value: new THREE.Color('#2a2f5c') },
        uLine: { value: new THREE.Color('#8d88c9') },
      },
    });
    this.#plane = new THREE.Mesh(planeGeo, planeMat);
    this.#plane.rotation.x = -Math.PI / 2;
    this.#plane.position.y = -0.04;
    this.#world.add(this.#plane);

    // Dust motes: few, neutral, slow, far from the centre — ambient only.
    const count = 220;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 6 + Math.pow(i / count, 0.6) * 22;
      const a = (i * 2.399963) % TAU; // golden angle: even, deterministic
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = ((i * 7919) % 100) / 100 * 7 - 2;
      positions[i * 3 + 2] = Math.sin(a) * r;
      seeds[i] = ((i * 104729) % 1000) / 1000;
    }
    const motesGeo = new THREE.BufferGeometry();
    motesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    motesGeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    motesGeo.userData.base = positions.slice();
    const motesMat = new THREE.PointsMaterial({ size: 0.09, color: new THREE.Color('#cfc7ff'), transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.#motes = new THREE.Points(motesGeo, motesMat);
    this.#world.add(this.#motes);

    // Lights: one warm key above the Founder (modest), one cool fill, ambient floor.
    const key = new THREE.PointLight(new THREE.Color('#ffe2b0'), 28, 70, 1.5);
    key.position.set(0, 10, 0);
    this.#world.add(key);
    const fill = new THREE.DirectionalLight(new THREE.Color('#8fa9ff'), 1.1);
    fill.position.set(-12, 16, -8);
    this.#world.add(fill);
    const rim = new THREE.DirectionalLight(new THREE.Color('#ffd9a8'), 0.5);
    rim.position.set(10, 6, 14);
    this.#world.add(rim);
    this.#world.add(new THREE.AmbientLight(new THREE.Color('#3a3566'), 1.6));

    this.#founderHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.#glowTexture, color: new THREE.Color(PALETTE.founderGlow), transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.#founderHalo.scale.set(3.4, 3.4, 1);
    this.#founderHalo.position.set(0, 0.9, 0);
    this.#world.add(this.#founderHalo);

    const ringGeo = new THREE.RingGeometry(0.62, 0.7, 48);
    this.#selectionRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff'), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.#selectionRing.rotation.x = -Math.PI / 2;
    this.#selectionRing.visible = false;
    this.#world.add(this.#selectionRing);
  }

  setLayout(layout: Layout): void {
    this.#layout = layout;
    const u = (this.#plane.material as THREE.ShaderMaterial).uniforms;
    (u.uCount as THREE.IUniform<number>).value = Math.max(1, layout.sectors.length);
    (u.uStart as THREE.IUniform<number>).value = layout.sectors[0]?.start ?? 0;
    (u.uRim as THREE.IUniform<number>).value = layout.rimRadius;
    (u.uOuter as THREE.IUniform<number>).value = layout.outerRadius;
    (u.uRings as THREE.IUniform<number[]>).value = layout.rings.slice(0, 4).map((r) => r.radius);
    // Nodes: reconcile by id (stable spatial memory: an unchanged node is never rebuilt).
    const seen = new Set<string>();
    for (const n of layout.nodes) {
      seen.add(n.id);
      const existing = this.#nodes.get(n.id);
      if (existing && sameNode(existing.node, n)) {
        existing.group.position.set(n.x, n.y, n.z);
        continue;
      }
      if (existing) this.#removeNode(n.id);
      this.#nodes.set(n.id, this.#makeNode(n, layout));
    }
    for (const id of [...this.#nodes.keys()]) if (!seen.has(id)) this.#removeNode(id);
    const seenEdges = new Set<string>();
    for (const e of layout.edges) {
      seenEdges.add(e.id);
      const existing = this.#edges.get(e.id);
      if (existing && existing.edge.from === e.from && existing.edge.to === e.to && existing.edge.kind === e.kind) continue;
      if (existing) this.#removeEdge(e.id);
      const ev = this.#makeEdge(e);
      if (ev) this.#edges.set(e.id, ev);
    }
    for (const id of [...this.#edges.keys()]) if (!seenEdges.has(id)) this.#removeEdge(id);
  }

  #makeNode(n: LayoutNode, layout: Layout): NodeVisual {
    const group = new THREE.Group();
    group.position.set(n.x, n.y, n.z);
    const color = new THREE.Color(nodeColor(n));
    const shape = statusShape(n);
    const radius = nodeRadius(n);
    let core: THREE.Mesh;
    let ring: THREE.Object3D | null = null;
    let runningArc: THREE.Mesh | null = null;
    const tethers: THREE.Mesh[] = [];
    if (n.kind === 'founder') {
      // A small warm core with a thin seal ring: the centre of gravity, not a sun.
      core = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), new THREE.MeshPhysicalMaterial({ color, emissive: new THREE.Color(PALETTE.founderGlow), emissiveIntensity: 0.38, roughness: 0.3, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.2 }));
      const seal = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.022, 12, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.founderGlow), transparent: true, opacity: 0.85 }));
      seal.rotation.x = Math.PI / 2;
      ring = seal;
      group.add(seal);
    } else if (n.kind === 'goal') {
      // A beacon: a faceted gem hovering over a pool of light, a slender beam rising from it, and one tether
      // per anchored Department down to that Department's rim — a strategic destination pulling on real work.
      const proposed = n.state === 'PROPOSED' || n.state === 'DRAFT';
      const gemMat = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: proposed ? 0.25 : 0.7, roughness: 0.25, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.15, transparent: proposed, opacity: proposed ? 0.55 : 1, flatShading: true });
      core = new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), gemMat);
      core.scale.set(1, 1.75, 1);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.09, 3.2, 10, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: proposed ? 0.12 : 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      beam.position.y = 1.35;
      group.add(beam);
      const pool = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.86, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: proposed ? 0.28 : 0.6, side: THREE.DoubleSide, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = -n.y + 0.02;
      ring = pool;
      group.add(pool);
      const poolGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.#glowTexture, color, transparent: true, opacity: proposed ? 0.18 : 0.38, depthWrite: false, blending: THREE.AdditiveBlending }));
      poolGlow.scale.set(2.6, 2.6, 1);
      poolGlow.position.y = -n.y + 0.05;
      group.add(poolGlow);
      for (const sectorIndex of n.anchors) {
        const s = layout.sectors[sectorIndex];
        if (!s) continue;
        const from = new THREE.Vector3(0, -n.y + 0.06, 0);
        const to = new THREE.Vector3(Math.cos(s.mid) * layout.rimRadius - n.x, -n.y + 0.06, Math.sin(s.mid) * layout.rimRadius - n.z);
        const mid = from.clone().add(to).multiplyScalar(0.5);
        mid.y += 0.35;
        const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
        const tether = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.028, 6, false), new THREE.MeshBasicMaterial({ color: new THREE.Color(departmentColor(sectorIndex)), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
        group.add(tether);
        tethers.push(tether);
      }
    } else if (n.kind === 'attention') {
      core = new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: n.state === 'URGENT' ? 1.2 : 0.8, roughness: 0.4, flatShading: true }));
    } else if (n.vacant) {
      core = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.vacant), wireframe: true, transparent: true, opacity: 0.5 }));
      const seat = new THREE.Mesh(new THREE.RingGeometry(radius + 0.1, radius + 0.16, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(departmentColor(n.sector)), transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      seat.rotation.x = -Math.PI / 2;
      seat.position.y = -n.y + 0.02;
      group.add(seat);
    } else {
      const active = n.state === 'ACTIVE';
      const dim = shape === 'hollow' || shape === 'broken' || !active;
      const mat = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: dim ? 0.18 : 0.32, roughness: 0.38, metalness: 0.12, clearcoat: 0.7, clearcoatRoughness: 0.25, transparent: dim, opacity: dim ? 0.62 : 1 });
      core = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), mat);
      // The seat mark on the plane: a thin ring in the Department hue under every person (identity + department).
      const seat = new THREE.Mesh(new THREE.RingGeometry(radius + 0.1, radius + 0.16, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(departmentColor(n.sector)), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      seat.rotation.x = -Math.PI / 2;
      seat.position.y = -n.y + 0.02;
      group.add(seat);
      const shadow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.#shadowTexture, transparent: true, opacity: 0.9, depthWrite: false }));
      shadow.scale.set(radius * 3.2, radius * 3.2, 1);
      shadow.position.y = -n.y + 0.01;
      group.add(shadow);
      if (shape === 'double' || shape === 'broken' || shape === 'hollow') {
        const geo = shape === 'broken' ? new THREE.RingGeometry(radius + 0.22, radius + 0.3, 32, 1, 0, Math.PI * 1.45) : new THREE.RingGeometry(radius + 0.22, radius + (shape === 'double' ? 0.36 : 0.28), 40);
        const r = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: shape === 'broken' ? new THREE.Color(PALETTE.blocked) : color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
        r.rotation.x = -Math.PI / 2;
        r.position.y = 0.02;
        ring = r;
        group.add(r);
      }
      if (n.running) {
        // A real state: work is running for this person now. A slow arc circles the core (static in reduced motion).
        runningArc = new THREE.Mesh(new THREE.RingGeometry(radius + 0.2, radius + 0.26, 40, 1, 0, Math.PI * 1.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.running), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
        runningArc.rotation.x = -Math.PI / 2;
        runningArc.position.y = 0.03;
        group.add(runningArc);
      }
    }
    group.add(core);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.#glowTexture, color, transparent: true, opacity: glowOpacity(n), depthWrite: false, blending: THREE.AdditiveBlending }));
    const gs = n.kind === 'founder' ? 2.2 : n.kind === 'goal' ? 2.2 : n.seatKind === 'CEO' ? 1.9 : n.seatKind === 'DIRECTOR' ? 1.5 : 1.1;
    glow.scale.set(gs, gs, 1);
    group.add(glow);
    core.userData.nodeId = n.id;
    group.userData.nodeId = n.id;
    this.#world.add(group);
    return { node: n, group, core, ring, glow, runningArc, tethers, weight: 1, arrive: null };
  }

  #removeNode(id: string): void {
    const v = this.#nodes.get(id);
    if (!v) return;
    this.#world.remove(v.group);
    v.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
      if (o instanceof THREE.Sprite) o.material.dispose();
    });
    this.#nodes.delete(id);
  }

  #makeEdge(e: LayoutEdge): EdgeVisual | null {
    const a = this.#nodes.get(e.from)?.group.position ?? (e.from === 'founder' ? new THREE.Vector3(0, 0.9, 0) : null);
    const b = this.#nodes.get(e.to)?.group.position ?? (e.to === 'founder' ? new THREE.Vector3(0, 0.9, 0) : null);
    if (!a || !b) return null;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += 0.9 + a.distanceTo(b) * 0.1;
    const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
    const geo = new THREE.TubeGeometry(curve, 32, e.kind === 'ESCALATION' || e.kind === 'APPROVAL' ? 0.04 : 0.028, 6, false);
    const color = new THREE.Color(RELATION_COLORS[e.kind] ?? '#ffffff');
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.userData.edgeId = e.id;
    this.#world.add(mesh);
    return { edge: e, mesh, curve, weight: 1, pulse: null, pulseStarted: 0 };
  }

  #removeEdge(id: string): void {
    const v = this.#edges.get(id);
    if (!v) return;
    this.#world.remove(v.mesh);
    v.mesh.geometry.dispose();
    (v.mesh.material as THREE.Material).dispose();
    if (v.pulse) {
      this.#world.remove(v.pulse);
      v.pulse.geometry.dispose();
      (v.pulse.material as THREE.Material).dispose();
    }
    this.#edges.delete(id);
  }

  setEmphasis(emphasis: Emphasis): void {
    for (const [id, v] of this.#nodes) v.weight = emphasis.nodes.get(id) ?? 1;
    for (const [id, v] of this.#edges) v.weight = emphasis.edges.get(id) ?? 1;
    const weights = (this.#plane.material as THREE.ShaderMaterial).uniforms.uWeights as THREE.IUniform<number[]>;
    weights.value = (this.#layout?.sectors ?? []).map((s) => emphasis.sectors.get(s.departmentId) ?? 1).concat([1, 1, 1, 1, 1]).slice(0, 5);
  }

  setSelection(nodeId: string | null): void {
    const v = nodeId === null ? undefined : this.#nodes.get(nodeId);
    if (!v) {
      this.#selectionRing.visible = false;
      return;
    }
    this.#selectionRing.visible = true;
    this.#selectionRing.position.copy(v.group.position);
    this.#selectionRing.position.y = 0.04;
    const s = v.node.kind === 'founder' ? 1.8 : v.node.kind === 'goal' ? 1.7 : v.node.seatKind === 'CEO' ? 1.25 : v.node.seatKind === 'DIRECTOR' ? 1.1 : 0.95;
    this.#selectionRing.scale.set(s, s, s);
  }

  focus(target: CameraTarget, immediate: boolean): void {
    const pos = new THREE.Vector3(target.x, target.y, target.z).add(CAMERA_DIR.clone().multiplyScalar(target.distance));
    const look = new THREE.Vector3(target.x, target.y, target.z);
    if (immediate || this.#reduced) {
      this.#camFrom = null;
      this.#camTo = { pos, look };
      this.#camera.position.copy(pos);
      this.#look.copy(look);
      return;
    }
    this.#camFrom = { pos: this.#camera.position.clone(), look: this.#look.clone() };
    this.#camTo = { pos, look };
    this.#camStart = performance.now();
    this.#camDuration = 520;
  }

  pulseEdge(edgeId: string): void {
    const v = this.#edges.get(edgeId);
    if (!v) return;
    if (this.#reduced) {
      // Static substitute: the edge brightens for a while instead of a travelling light.
      (v.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      setTimeout(() => ((v.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7), 2500);
      return;
    }
    if (!v.pulse) {
      v.pulse = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff'), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.#world.add(v.pulse);
    }
    v.pulseStarted = performance.now();
  }

  arriveAttention(nodeId: string, fromNodeId: string | null): void {
    const v = this.#nodes.get(nodeId);
    if (!v || this.#reduced) return;
    const from = fromNodeId === null ? null : this.#nodes.get(fromNodeId)?.group.position.clone();
    if (!from) return;
    v.arrive = { from, started: performance.now() };
  }

  setReducedMotion(reduced: boolean): void {
    this.#reduced = reduced;
    this.#uniform(this.#background, 'uDrift').value = reduced ? 0 : 1;
    this.#uniform(this.#plane, 'uBreath').value = reduced ? 0 : 1;
    this.#motes.visible = !reduced;
    if (reduced) {
      this.#parallax.set(0, 0);
      this.#camFrom = null;
      this.#camera.position.copy(this.#camTo.pos);
      this.#look.copy(this.#camTo.look);
      for (const v of this.#nodes.values()) if (v.runningArc) v.runningArc.rotation.z = 0;
    }
  }

  setLive(live: boolean): void {
    this.#live = live;
    // Historical Focus desaturates the atmosphere slightly and stills the motes: the same company, another instant.
    (this.#motes.material as THREE.PointsMaterial).opacity = live ? 0.22 : 0.08;
    this.#uniform(this.#background, 'uDrift').value = live && !this.#reduced ? 1 : 0;
    this.#renderer.toneMappingExposure = live ? 1.0 : 0.82;
  }

  /** A numeric shader uniform declared at construction (a missing name is a programming error, not a runtime state). */
  #uniform(mesh: THREE.Mesh, name: string): THREE.IUniform<number> {
    const u = (mesh.material as THREE.ShaderMaterial).uniforms[name];
    if (!u) throw new Error(`shader uniform ${name} is not declared`);
    return u as THREE.IUniform<number>;
  }

  project(nodeId: string): Projection | null {
    const v = this.#nodes.get(nodeId);
    if (!v) return null;
    const p = v.group.position;
    // Captions sit above their marks; the Founder's hangs below the centre so the CEO caption (nearest orbit,
    // at the top) never collides with it; a goal's clears the beam.
    const lift = v.node.kind === 'goal' ? 2.05 : v.node.kind === 'founder' ? -1.3 : v.node.seatKind === 'CEO' ? 0.95 : v.node.kind === 'attention' ? 0.5 : nodeRadius(v.node) + 0.36;
    return this.projectPoint(p.x, p.y + lift, p.z);
  }

  projectPoint(x: number, y: number, z: number): Projection {
    const p = this.#tmp.set(x, y, z);
    // A point behind the camera projects to a mirrored position: cull it in view space first.
    const view = p.clone().applyMatrix4(this.#camera.matrixWorldInverse);
    const inFront = view.z < -this.#camera.near;
    const distance = -view.z;
    p.project(this.#camera);
    const w = this.#container.clientWidth;
    const h = this.#container.clientHeight;
    const look = Math.max(1, this.#camera.position.distanceTo(this.#look));
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, visible: inFront && p.z < 1 && p.x > -1.02 && p.x < 1.02 && p.y > -1.02 && p.y < 1.02, depth: clamp01((distance / look - 0.55) / 0.9) };
  }

  resize(): void {
    const w = this.#container.clientWidth || 1;
    const h = this.#container.clientHeight || 1;
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(w, h, false);
  }

  dispose(): void {
    this.#disposed = true;
    cancelAnimationFrame(this.#raf);
    for (const id of [...this.#nodes.keys()]) this.#removeNode(id);
    for (const id of [...this.#edges.keys()]) this.#removeEdge(id);
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }

  #onPointerMove(e: PointerEvent): void {
    const rect = this.#container.getBoundingClientRect();
    this.#pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
    this.#parallaxTarget(this.#pointer.x, this.#pointer.y);
    this.#ray.setFromCamera(this.#pointer, this.#camera);
    const hit = this.#ray.intersectObjects([...this.#nodes.values()].map((v) => v.core), false)[0];
    const id = hit ? (hit.object.userData.nodeId as string) : null;
    if (id !== this.#hovered) {
      this.#hovered = id;
      this.#container.style.cursor = id ? 'pointer' : 'default';
      this.#events.onHover(id);
    }
  }

  #parallaxTarget(x: number, y: number): void {
    if (this.#reduced) return;
    this.#parallax.set(x * 0.7, y * 0.4);
  }

  #onClick(e: PointerEvent | MouseEvent): void {
    const rect = this.#container.getBoundingClientRect();
    this.#pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
    this.#ray.setFromCamera(this.#pointer, this.#camera);
    const hit = this.#ray.intersectObjects([...this.#nodes.values()].map((v) => v.core), false)[0];
    if (!hit) return;
    const id = hit.object.userData.nodeId as string;
    const v = this.#nodes.get(id);
    if (v) this.#events.onSelect(id, v.node);
  }

  #loop = (): void => {
    if (this.#disposed) return;
    this.#raf = requestAnimationFrame(this.#loop);
    this.#frame();
  };

  #frame(): void {
    this.#timer.update();
    const t = this.#timer.getElapsed();
    const now = performance.now();
    this.#uniform(this.#background, 'uTime').value = t;
    this.#uniform(this.#plane, 'uTime').value = t;

    // Ambient: motes drift (neutral, slow), the Founder halo breathes. None of this reads as an event.
    if (!this.#reduced && this.#live) {
      const pos = this.#motes.geometry.getAttribute('position') as THREE.BufferAttribute;
      const base = this.#motes.geometry.userData.base as Float32Array;
      const seeds = this.#motes.geometry.getAttribute('seed') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const s = seeds.getX(i);
        pos.setXYZ(i, (base[i * 3] ?? 0) + Math.sin(t * 0.05 + s * 9) * 0.4, (base[i * 3 + 1] ?? 0) + Math.sin(t * 0.09 + s * 5) * 0.3, (base[i * 3 + 2] ?? 0) + Math.cos(t * 0.045 + s * 7) * 0.4);
      }
      pos.needsUpdate = true;
      const breath = 1 + Math.sin(t * 0.5) * 0.05;
      this.#founderHalo.scale.set(3.4 * breath, 3.4 * breath, 1);
    }

    // Node emphasis (lens) and one-shot semantic motions.
    for (const v of this.#nodes.values()) {
      const target = 0.12 + 0.88 * v.weight;
      const core = v.core.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
      if ('opacity' in core) {
        const shape = statusShape(v.node);
        const base = v.node.vacant ? 0.5 : shape === 'hollow' || shape === 'broken' || (v.node.kind === 'employee' && v.node.state !== 'ACTIVE') ? 0.62 : v.node.kind === 'goal' && (v.node.state === 'PROPOSED' || v.node.state === 'DRAFT') ? 0.55 : 1;
        const want = base * target;
        core.transparent = want < 0.999;
        core.opacity += (want - core.opacity) * 0.15;
      }
      (v.glow.material as THREE.SpriteMaterial).opacity = glowOpacity(v.node) * target;
      if (v.ring) v.ring.visible = v.weight > 0.3;
      for (const tether of v.tethers) (tether.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.55 * v.weight;
      if (v.runningArc) {
        v.runningArc.visible = v.weight > 0.3;
        if (!this.#reduced && this.#live) v.runningArc.rotation.z = t * 0.9;
      }
      if (v.arrive) {
        const k = clamp01((now - v.arrive.started) / 900);
        const e = EASE_IN_OUT(k);
        const n = v.node;
        v.group.position.set(v.arrive.from.x + (n.x - v.arrive.from.x) * e, v.arrive.from.y + (n.y - v.arrive.from.y) * e + Math.sin(k * Math.PI) * 0.9, v.arrive.from.z + (n.z - v.arrive.from.z) * e);
        if (k >= 1) v.arrive = null;
      }
      if ((v.node.kind === 'attention' || v.node.kind === 'goal') && !this.#reduced && this.#live) v.core.rotation.y = t * (v.node.kind === 'goal' ? 0.35 : 0.8);
    }
    for (const v of this.#edges.values()) {
      const mat = v.mesh.material as THREE.MeshBasicMaterial;
      const want = 0.05 + 0.7 * v.weight;
      mat.opacity += (want - mat.opacity) * 0.15;
      if (v.pulse) {
        const k = (now - v.pulseStarted) / 1100;
        if (k >= 1) {
          this.#world.remove(v.pulse);
          v.pulse.geometry.dispose();
          (v.pulse.material as THREE.Material).dispose();
          v.pulse = null;
        } else {
          v.curve.getPoint(EASE_IN_OUT(clamp01(k)), v.pulse.position);
          (v.pulse.material as THREE.MeshBasicMaterial).opacity = 0.95 * Math.sin(k * Math.PI);
        }
      }
    }

    // Camera: eased focus / return; parallax micro-depth on top (ambient, off in reduced motion).
    if (this.#camFrom) {
      const k = clamp01((now - this.#camStart) / this.#camDuration);
      const e = EASE_IN_OUT(k);
      this.#camera.position.lerpVectors(this.#camFrom.pos, this.#camTo.pos, e);
      this.#look.lerpVectors(this.#camFrom.look, this.#camTo.look, e);
      if (k >= 1) this.#camFrom = null;
    } else {
      this.#camera.position.copy(this.#camTo.pos);
      this.#look.copy(this.#camTo.look);
    }
    const p = this.#parallax;
    this.#camera.position.x += p.x;
    this.#camera.position.y += p.y * 0.6;
    this.#camera.lookAt(this.#look);
    this.#camera.updateMatrixWorld();
    ((this.#background.material as THREE.ShaderMaterial).uniforms.uLook as THREE.IUniform<THREE.Vector3>).value.copy(this.#look).sub(this.#camera.position).normalize();
    const distance = this.#camera.position.distanceTo(this.#look);
    if (Math.abs(distance - this.#lastDistance) > 0.05) {
      this.#lastDistance = distance;
      this.#events.onDistance(distance);
    }
    this.#renderer.render(this.#scene, this.#camera);
  }
}

function glowOpacity(n: LayoutNode): number {
  if (n.kind === 'attention') return 0.6;
  if (n.kind === 'goal') return 0.42;
  if (n.kind === 'founder') return 0.3;
  return 0.2;
}

function sameNode(a: LayoutNode, b: LayoutNode): boolean {
  return a.kind === b.kind && a.state === b.state && a.acting === b.acting && a.vacant === b.vacant && a.seatKind === b.seatKind && a.sector === b.sector && a.sublabel === b.sublabel && a.running === b.running && a.anchors.join(',') === b.anchors.join(',') && a.x === b.x && a.z === b.z;
}

function makeRadialTexture(stops: readonly (readonly [number, string])[]): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable for the sprite textures');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    return c.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export const easeOut = EASE_OUT;
