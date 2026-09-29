/**
 * The living Company Universe (three.js, WebGL 2). Geometry, light and atmosphere only: every word is in
 * the HTML label layer.
 *
 * Two motion layers, kept apart by construction (C5 §7.2):
 * - AMBIENT LIFE — the nebula drift, dust motes, sector-field breathing, the Founder core's halo and the
 *   pointer parallax. Neutral in colour, without direction between entities, never triggered by data, and
 *   removed entirely in reduced-motion mode. It cannot be mistaken for a company event because it never
 *   touches a node or an edge.
 * - SEMANTIC MOTION — camera focus / return, an edge pulse when a relation appears or changes, an attention
 *   item gliding inward when it is new, the selection ring. Each starts from real state and is listed in
 *   the activity strip. In reduced-motion mode these become cuts and static badges: nothing disappears.
 */
import * as THREE from 'three';

import type { Emphasis, Layout, LayoutEdge, LayoutNode } from '../model/types.js';
import { departmentColor, nodeColor, PALETTE, RELATION_COLORS, statusShape, type CameraTarget, type RendererEvents, type UniverseRenderer } from './renderer.js';

const EASE_OUT = (t: number): number => 1 - Math.pow(1 - t, 3);
const EASE_IN_OUT = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const BACKGROUND_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// A deep gradient with two slow, low-frequency light fields (value noise) and a vignette: depth without a
// starfield, without neon. uDrift is 0 in reduced motion (a still gradient keeps the depth).
const BACKGROUND_FRAG = `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform float uDrift;
uniform vec3 uDeep;
uniform vec3 uHaze;
uniform vec3 uWarm;
uniform vec3 uCool;
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
  vec3 base = mix(uDeep, uHaze, smoothstep(0.15, 0.85, up));
  float n1 = noise(d * 2.2 + vec3(t * 0.015, t * 0.01, 0.0));
  float n2 = noise(d * 4.5 - vec3(0.0, t * 0.02, t * 0.012));
  float field = smoothstep(0.45, 0.85, n1 * 0.7 + n2 * 0.3);
  vec3 tint = mix(uCool, uWarm, smoothstep(0.3, 0.9, noise(d * 1.3 + vec3(t * 0.006))));
  vec3 color = base + tint * field * 0.16;
  float vignette = 1.0 - smoothstep(0.55, 1.35, length(vec2(d.x, d.z)) * 1.1);
  color *= 0.75 + 0.25 * vignette;
  gl_FragColor = vec4(color, 1.0);
}`;

// Sector fields: faint radial wedges on the orbit plane, soft-edged, with the department hue at low alpha.
const SECTOR_VERT = `
varying vec3 vPos;
void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SECTOR_FRAG = `
precision highp float;
varying vec3 vPos;
uniform float uTime;
uniform float uBreath;
uniform float uCount;
uniform float uStart;
uniform float uGap;
uniform vec3 uColors[5];
uniform float uWeights[5];
uniform float uOuter;
void main() {
  float r = length(vPos.xy);
  float a = atan(vPos.y, vPos.x);
  float span = (6.28318530718 - uGap) / max(uCount, 1.0);
  float rel = mod(a - uStart + 6.28318530718 * 3.0, 6.28318530718);
  if (rel > 6.28318530718 - uGap) discard;
  float idx = floor(rel / span);
  float within = fract(rel / span);
  float edge = smoothstep(0.0, 0.08, within) * smoothstep(0.0, 0.08, 1.0 - within);
  float radial = smoothstep(1.6, 4.0, r) * (1.0 - smoothstep(uOuter * 0.78, uOuter, r));
  int i = int(idx);
  vec3 c = uColors[0]; float w = uWeights[0];
  if (i == 1) { c = uColors[1]; w = uWeights[1]; }
  if (i == 2) { c = uColors[2]; w = uWeights[2]; }
  if (i == 3) { c = uColors[3]; w = uWeights[3]; }
  if (i == 4) { c = uColors[4]; w = uWeights[4]; }
  float breath = 1.0 + uBreath * 0.05 * sin(uTime * 0.25 + idx * 1.3);
  float alpha = 0.085 * edge * radial * breath * (0.35 + 0.65 * w);
  gl_FragColor = vec4(c, alpha);
}`;

interface NodeVisual {
  readonly node: LayoutNode;
  readonly group: THREE.Group;
  readonly core: THREE.Mesh;
  readonly ring: THREE.Object3D | null;
  readonly glow: THREE.Sprite;
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

export class WebGlUniverse implements UniverseRenderer {
  readonly kind = 'webgl' as const;
  #renderer!: THREE.WebGLRenderer;
  #scene = new THREE.Scene();
  #camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  #container!: HTMLElement;
  #events!: RendererEvents;
  #nodes = new Map<string, NodeVisual>();
  #edges = new Map<string, EdgeVisual>();
  #world = new THREE.Group();
  #background!: THREE.Mesh;
  #sectorField!: THREE.Mesh;
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
  #camTo = { pos: new THREE.Vector3(0, 27, 26), look: new THREE.Vector3(0, 0, 0) };
  #camStart = 0;
  #camDuration = 0;
  #look = new THREE.Vector3(0, 0, 0);
  #glowTexture!: THREE.Texture;
  #hovered: string | null = null;
  #disposed = false;
  #lastDistance = 0;

  mount(container: HTMLElement, events: RendererEvents): void {
    this.#container = container;
    this.#events = events;
    this.#renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.05;
    this.#renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.#renderer.domElement);
    this.#scene.fog = new THREE.FogExp2(new THREE.Color(PALETTE.haze).getHex(), 0.012);
    this.#scene.add(this.#world);
    this.#glowTexture = makeGlowTexture();
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
      vertexShader: BACKGROUND_VERT,
      fragmentShader: BACKGROUND_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: { value: 0 }, uDrift: { value: 1 }, uDeep: { value: new THREE.Color(PALETTE.deep) }, uHaze: { value: new THREE.Color('#231c52') }, uWarm: { value: new THREE.Color('#5a3a5c') }, uCool: { value: new THREE.Color('#1f3f6e') } },
    });
    this.#background = new THREE.Mesh(bgGeo, bgMat);
    this.#scene.add(this.#background);

    const fieldGeo = new THREE.CircleGeometry(15.6, 96);
    const fieldMat = new THREE.ShaderMaterial({
      vertexShader: SECTOR_VERT,
      fragmentShader: SECTOR_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uBreath: { value: 1 }, uCount: { value: 5 }, uStart: { value: 0 }, uGap: { value: 0.36 }, uColors: { value: Array.from({ length: 5 }, (_, i) => new THREE.Color(departmentColor(i))) }, uWeights: { value: [1, 1, 1, 1, 1] }, uOuter: { value: 15.6 } },
    });
    this.#sectorField = new THREE.Mesh(fieldGeo, fieldMat);
    this.#sectorField.rotation.x = -Math.PI / 2;
    this.#sectorField.position.y = -0.05;
    this.#world.add(this.#sectorField);

    // Dust motes: neutral, slow, no direction relating to any entity (ambient only).
    const count = 520;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 3 + Math.pow(i / count, 0.7) * 22;
      const a = (i * 2.399963) % (Math.PI * 2); // golden angle: even, deterministic
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = ((i * 7919) % 100) / 100 * 6 - 1.5;
      positions[i * 3 + 2] = Math.sin(a) * r;
      seeds[i] = ((i * 104729) % 1000) / 1000;
    }
    const motesGeo = new THREE.BufferGeometry();
    motesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    motesGeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    motesGeo.userData.base = positions.slice();
    const motesMat = new THREE.PointsMaterial({ size: 0.11, color: new THREE.Color('#cfc7ff'), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.#motes = new THREE.Points(motesGeo, motesMat);
    this.#world.add(this.#motes);

    // Orbit rings: thin, recessive lines (the structure the eye learns).
    for (const radius of [2.6, 5.4, 8.2, 11]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0.02, Math.sin(a) * radius));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color('#8f86d8'), transparent: true, opacity: radius === 2.6 ? 0.28 : 0.16 }));
      this.#world.add(line);
    }

    // Lights: one warm key from above the Founder, one cool fill, ambient floor.
    const key = new THREE.PointLight(new THREE.Color('#ffe2b0'), 60, 60, 1.6);
    key.position.set(0, 9, 0);
    this.#world.add(key);
    const fill = new THREE.DirectionalLight(new THREE.Color('#8fa9ff'), 0.9);
    fill.position.set(-12, 16, -8);
    this.#world.add(fill);
    this.#world.add(new THREE.AmbientLight(new THREE.Color('#3a3566'), 1.4));

    this.#founderHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.#glowTexture, color: new THREE.Color(PALETTE.founderGlow), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.#founderHalo.scale.set(6.5, 6.5, 1);
    this.#founderHalo.position.set(0, 0.9, 0);
    this.#world.add(this.#founderHalo);

    const ringGeo = new THREE.RingGeometry(0.62, 0.72, 48);
    this.#selectionRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff'), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.#selectionRing.rotation.x = -Math.PI / 2;
    this.#selectionRing.visible = false;
    this.#world.add(this.#selectionRing);
  }

  setLayout(layout: Layout): void {
    this.#layout = layout;
    const field = this.#sectorField.material as THREE.ShaderMaterial;
    (field.uniforms.uCount as THREE.IUniform<number>).value = Math.max(1, layout.sectors.length);
    (field.uniforms.uStart as THREE.IUniform<number>).value = layout.sectors[0]?.start ?? 0;
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
      this.#nodes.set(n.id, this.#makeNode(n));
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

  #makeNode(n: LayoutNode): NodeVisual {
    const group = new THREE.Group();
    group.position.set(n.x, n.y, n.z);
    const color = new THREE.Color(nodeColor(n));
    const shape = statusShape(n);
    let core: THREE.Mesh;
    let ring: THREE.Object3D | null = null;
    if (n.kind === 'founder') {
      core = new THREE.Mesh(new THREE.SphereGeometry(0.62, 40, 32), new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(PALETTE.founderGlow), emissiveIntensity: 0.75, roughness: 0.35, metalness: 0.1 }));
    } else if (n.kind === 'goal') {
      // A beacon: a slender pillar of light standing outside the orbits, brighter for company goals.
      core = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 3.4, 12, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      core.position.y = 1.2;
      const base = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.42, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: n.state === 'ACTIVE' ? 0.9 : 0.45, side: THREE.DoubleSide, depthWrite: false }));
      base.rotation.x = -Math.PI / 2;
      base.position.y = -1.35;
      ring = base;
      group.add(base);
    } else if (n.kind === 'attention') {
      core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: n.state === 'URGENT' ? 1.4 : 0.9, roughness: 0.4 }));
    } else if (n.vacant) {
      core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.vacant), wireframe: true, transparent: true, opacity: 0.55 }));
    } else {
      const radius = n.seatKind === 'CEO' ? 0.46 : n.seatKind === 'DIRECTOR' ? 0.38 : 0.28;
      const running = n.state === 'ACTIVE';
      const mat = shape === 'hollow' || shape === 'broken' ? new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.5, transparent: true, opacity: 0.55 }) : new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: running ? 0.55 : 0.3, roughness: 0.45, metalness: 0.05 });
      core = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), mat);
      if (shape === 'double' || shape === 'broken' || shape === 'hollow') {
        const geo = shape === 'broken' ? new THREE.RingGeometry(radius + 0.16, radius + 0.24, 32, 1, 0, Math.PI * 1.45) : new THREE.RingGeometry(radius + 0.16, radius + (shape === 'double' ? 0.3 : 0.22), 40);
        const r = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: shape === 'broken' ? new THREE.Color(PALETTE.blocked) : color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
        r.rotation.x = -Math.PI / 2;
        r.position.y = 0.02;
        ring = r;
        group.add(r);
      }
    }
    group.add(core);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.#glowTexture, color, transparent: true, opacity: n.kind === 'goal' ? 0.5 : n.kind === 'attention' ? 0.7 : 0.38, depthWrite: false, blending: THREE.AdditiveBlending }));
    const gs = n.kind === 'founder' ? 3.2 : n.kind === 'goal' ? 2.6 : n.seatKind === 'CEO' ? 2.4 : n.seatKind === 'DIRECTOR' ? 2 : 1.4;
    glow.scale.set(gs, gs, 1);
    glow.position.y = n.kind === 'goal' ? 2.8 : 0;
    group.add(glow);
    core.userData.nodeId = n.id;
    group.userData.nodeId = n.id;
    this.#world.add(group);
    return { node: n, group, core, ring, glow, weight: 1, arrive: null };
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
    mid.y += 1.1 + a.distanceTo(b) * 0.12;
    const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
    const geo = new THREE.TubeGeometry(curve, 28, e.kind === 'ESCALATION' || e.kind === 'APPROVAL' ? 0.05 : 0.035, 6, false);
    const color = new THREE.Color(RELATION_COLORS[e.kind] ?? '#ffffff');
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
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
    const weights = (this.#sectorField.material as THREE.ShaderMaterial).uniforms.uWeights as THREE.IUniform<number[]>;
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
    this.#selectionRing.position.y += v.node.kind === 'goal' ? -1.3 : 0.03;
    const s = v.node.kind === 'founder' ? 1.6 : v.node.seatKind === 'CEO' ? 1.2 : 1;
    this.#selectionRing.scale.set(s, s, s);
  }

  focus(target: CameraTarget, immediate: boolean): void {
    const dir = new THREE.Vector3(0, 0.95, 0.92).normalize();
    const pos = new THREE.Vector3(target.x, target.y, target.z).add(dir.multiplyScalar(target.distance));
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
    this.#camDuration = 560;
  }

  pulseEdge(edgeId: string): void {
    const v = this.#edges.get(edgeId);
    if (!v) return;
    if (this.#reduced) {
      // Static substitute: the edge brightens for a while instead of a travelling light.
      (v.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      setTimeout(() => ((v.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75), 2500);
      return;
    }
    if (!v.pulse) {
      v.pulse = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff'), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
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
    this.#uniform(this.#sectorField, 'uBreath').value = reduced ? 0 : 1;
    this.#motes.visible = !reduced;
    if (reduced) {
      this.#parallax.set(0, 0);
      this.#camFrom = null;
      this.#camera.position.copy(this.#camTo.pos);
      this.#look.copy(this.#camTo.look);
    }
  }

  setLive(live: boolean): void {
    this.#live = live;
    // Historical Focus desaturates the atmosphere slightly and stills the motes: the same company, another instant.
    (this.#motes.material as THREE.PointsMaterial).opacity = live ? 0.35 : 0.12;
    this.#uniform(this.#background, 'uDrift').value = live && !this.#reduced ? 1 : 0;
  }

  /** A numeric shader uniform declared at construction (a missing name is a programming error, not a runtime state). */
  #uniform(mesh: THREE.Mesh, name: string): THREE.IUniform<number> {
    const u = (mesh.material as THREE.ShaderMaterial).uniforms[name];
    if (!u) throw new Error(`shader uniform ${name} is not declared`);
    return u as THREE.IUniform<number>;
  }

  project(nodeId: string): { x: number; y: number; visible: boolean; depth: number } | null {
    const v = this.#nodes.get(nodeId);
    if (!v) return null;
    const p = v.group.position.clone();
    // The Founder's caption hangs below the centre so the CEO caption (nearest orbit, at the top) never collides with it.
    p.y += v.node.kind === 'goal' ? 3.1 : v.node.kind === 'founder' ? -1.35 : v.node.seatKind === 'CEO' ? 1.0 : 0.62;
    // A point behind the camera projects to a mirrored position: cull it in view space first.
    const inFront = p.clone().applyMatrix4(this.#camera.matrixWorldInverse).z < -this.#camera.near;
    p.project(this.#camera);
    const w = this.#container.clientWidth;
    const h = this.#container.clientHeight;
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, visible: inFront && p.z < 1 && p.x > -1.02 && p.x < 1.02 && p.y > -1.02 && p.y < 1.02, depth: p.z };
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
    this.#parallax.set(x * 0.55, y * 0.35);
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
    this.#uniform(this.#sectorField, 'uTime').value = t;

    // Ambient: motes drift (neutral, slow), Founder halo breathes. None of this reads as an event.
    if (!this.#reduced && this.#live) {
      const pos = this.#motes.geometry.getAttribute('position') as THREE.BufferAttribute;
      const base = this.#motes.geometry.userData.base as Float32Array;
      const seeds = this.#motes.geometry.getAttribute('seed') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const s = seeds.getX(i);
        pos.setXYZ(i, (base[i * 3] ?? 0) + Math.sin(t * 0.07 + s * 9) * 0.35, (base[i * 3 + 1] ?? 0) + Math.sin(t * 0.11 + s * 5) * 0.25, (base[i * 3 + 2] ?? 0) + Math.cos(t * 0.06 + s * 7) * 0.35);
      }
      pos.needsUpdate = true;
      const breath = 1 + Math.sin(t * 0.6) * 0.045;
      this.#founderHalo.scale.set(6.5 * breath, 6.5 * breath, 1);
    }

    // Node emphasis (lens) and one-shot semantic motions.
    for (const v of this.#nodes.values()) {
      const target = 0.12 + 0.88 * v.weight;
      const core = v.core.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
      if ('opacity' in core) {
        const want = v.node.vacant ? 0.55 * target : (statusShape(v.node) === 'hollow' || statusShape(v.node) === 'broken' ? 0.55 : 1) * target;
        core.transparent = want < 0.999;
        core.opacity += (want - core.opacity) * 0.15;
      }
      (v.glow.material as THREE.SpriteMaterial).opacity = (v.node.kind === 'attention' ? 0.7 : v.node.kind === 'goal' ? 0.5 : 0.38) * target;
      if (v.ring) v.ring.visible = v.weight > 0.3;
      if (v.arrive) {
        const k = clamp01((now - v.arrive.started) / 900);
        const e = EASE_IN_OUT(k);
        const n = v.node;
        v.group.position.set(v.arrive.from.x + (n.x - v.arrive.from.x) * e, v.arrive.from.y + (n.y - v.arrive.from.y) * e + Math.sin(k * Math.PI) * 0.9, v.arrive.from.z + (n.z - v.arrive.from.z) * e);
        if (k >= 1) v.arrive = null;
      }
      if (v.node.kind === 'attention' && !this.#reduced) v.core.rotation.y = t * 0.8;
    }
    for (const v of this.#edges.values()) {
      const mat = v.mesh.material as THREE.MeshBasicMaterial;
      const want = 0.06 + 0.72 * v.weight;
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
    const distance = this.#camera.position.distanceTo(this.#look);
    if (Math.abs(distance - this.#lastDistance) > 0.05) {
      this.#lastDistance = distance;
      this.#events.onDistance(distance);
    }
    this.#renderer.render(this.#scene, this.#camera);
  }
}

function sameNode(a: LayoutNode, b: LayoutNode): boolean {
  return a.kind === b.kind && a.state === b.state && a.acting === b.acting && a.vacant === b.vacant && a.seatKind === b.seatKind && a.sector === b.sector && a.sublabel === b.sublabel;
}

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable for the glow texture');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
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
