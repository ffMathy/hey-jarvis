import{G as e,K as t,r as n}from"./room-session-BhxPqhD9.js";import{B as r,D as i,E as a,F as o,H as s,M as c,R as l,S as u,U as d,V as f,W as p,b as m,h,j as ee,t as g,z as te}from"./view-plane-quad-BvqW1h76.js";import{D as _,L as v,M as y,_ as b,a as x,d as S,g as C,k as w,l as T,m as E,n as D,p as O,r as k,w as A,y as j}from"./three-BdQlZwYR.js";function M(e){let{position:t,orientation:n}=e.transform;return{position:new v(t.x,t.y,t.z),orientation:new _(n.x,n.y,n.z,n.w)}}function N(e,t){let n=e.getViewerPose(t);return n===void 0?null:M(n)}function P(e){return new v(0,0,-1).applyQuaternion(e.orientation)}function ne(e,t){let n=P(e),r=new v(n.x,0,n.z);if(r.lengthSq()<1e-6){let t=new v(0,1,0).applyQuaternion(e.orientation);r.set(t.x,0,t.z).multiplyScalar(n.y<0?1:-1)}return r.normalize(),e.position.clone().addScaledVector(r,t)}function F(e,t){let n=Array.from(e??[]).filter(e=>Number.isFinite(e)&&e>0);if(n.length===0)return;let r=Math.min(...n);if(t===`lowest`)return r;let i=n.filter(e=>e<=90);return i.length>0?Math.max(...i):r}var I=.3,L={alpha:!0,antialias:!0,premultipliedAlpha:!0},R=.1;function z(e,t){if(t===void 0)return e;let{position:r,orientation:i}=n(t);return e.getOffsetReferenceSpace(new XRRigidTransform({...r,w:1},i))}function B(e,t){for(let n of e)try{n(t)}catch(e){console.error(e)}}async function V(e,t={}){let n=new D(L);n.setClearColor(0,0),n.xr.enabled=!0,n.xr.setReferenceSpaceType(`local-floor`);let r=new y,i=new A,a=new Promise(t=>e.addEventListener(`end`,()=>t(),{once:!0})),o=!1;a.then(()=>{o=!0}),await n.xr.setSession(e),n.xr.setFoveation(I);let s=n.xr.getReferenceSpace();if(s===null)throw Error(`The headset gave the room no floor to stand things on.`);let c=z(s,t.origin);c!==s&&n.xr.setReferenceSpace(c);let l=new Set,u=new Set,d=new Set,f=0,p,m;return s.addEventListener(`reset`,()=>{f+=1,B(d,f)}),e.addEventListener(`visibilitychange`,()=>B(u,e.visibilityState)),n.setAnimationLoop((t,a)=>{if(a===void 0)return;let o=a.getViewerPose(c);if(o!==void 0){let n=m===void 0?0:Math.min(R,Math.max(0,(t-m)/1e3));m=t;let r=M(o),i=e.frameRate;B(l,{frame:a,referenceSpace:c,viewerPose:o,centreEye:r,time:t,deltaSeconds:n,displayRate:i,epoch:f})}n.render(r,i)}),{session:e,renderer:n,scene:r,referenceSpace:c,get visibility(){return e.visibilityState},get epoch(){return f},get requestedFrameRate(){return p},get supportedFrameRates(){return Array.from(e.supportedFrameRates??[])},ended:a,onFrame(e){return l.add(e),()=>l.delete(e)},onVisibility(e){return u.add(e),()=>u.delete(e)},onReset(e){return d.add(e),()=>d.delete(e)},setFrameRate(t){let n=F(e.supportedFrameRates,t);return n===void 0||n===p||typeof e.updateTargetFrameRate!=`function`?Promise.resolve():(p=n,e.updateTargetFrameRate(n).catch(()=>{p=void 0}))},end(){o||e.end().catch(()=>void 0)},dispose(){n.setAnimationLoop(null),l.clear(),u.clear(),d.clear(),n.dispose()}}}var H=.13,U=1.5,W=1.7,G=.75,K=`
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
// The centre eye, in the same space as the centres: both eyes turn each quad the same way.
uniform vec3 eye;

in vec2 corner;
in vec3 centre;
in float level;

// Where this corner is, in rim radii from the middle.
out vec2 local;
flat out float fade;

const float RADIUS = ${i(H)};
const float MIN_TANGENT = ${i(Math.tan(U*Math.PI/180))};
const float QUAD_REACH = ${i(W)};

void main() {
  vec3 toEye = eye - centre;
  float distance = length(toEye);
  vec3 front = distance > 1e-5 ? toEye / distance : vec3(0.0, 0.0, 1.0);
  // The world's up made square to the view, so the band stays level; straight above or below, where
  // nothing of it is left, the reference space's x stands in.
  vec3 up = vec3(0.0, 1.0, 0.0) - front * front.y;
  up = length(up) > 1e-3 ? normalize(up) : normalize(cross(front, vec3(1.0, 0.0, 0.0)));
  vec3 right = cross(up, front);
  float radius = max(RADIUS, distance * MIN_TANGENT);
  // Out from 2.5 radii, gone inside 1.5, as he is (closeRangeFade in head.ts).
  float near = clamp(distance / radius - 1.5, 0.0, 1.0);
  fade = level * near * near * (3.0 - 2.0 * near);
  local = corner * QUAD_REACH;
  vec3 world = centre + (right * local.x + up * local.y) * radius;
  // One faded to nothing goes past the far plane, so none of it is drawn.
  gl_Position = fade > 0.0 ? projectionMatrix * modelViewMatrix * vec4(world, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`,q=`
precision highp float;

uniform float time;
uniform float alphaFromLight;

in vec2 local;
flat in float fade;

out vec4 colour;

const vec3 HALO = ${a(h.colour)};
const vec3 DIM = ${a(m.dim.colour)};
const vec3 BRIGHT = ${a(m.bright.colour)};
const vec3 HOT = ${a(m.hot.colour)};
const float THINNEST_PIXELS = ${i(u)};
const float SCAN_SECONDS = ${i(e)};
const float SCAN_SOFTNESS = ${i(t)};
const float SCAN_TRAVEL = ${i(G)};
const float ROLL_RADIANS_PER_SECOND = ${i(44*Math.PI/180)};
const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

// The rim: its half-width, and how lit it is where the band is nowhere near.
const float RIM_HALF = 0.02;
const float RIM_FLOOR = 0.5;
// The chips outside it, as on his outer rim: how many places for one, and how far out, in rim radii.
const float CHIPS = 28.0;
const float CHIP_MIDDLE = 1.14;
// The band's dashes: how long a place for one is, in rim radii, and how thick a dash is (half).
const float DASH_CELL = 0.14;
const float DASH_HALF_WIDTH = 0.012;
// The halo round the rim: how far it spreads and how strong it is at the rim.
const float HALO_SPREAD = 0.3;
const float HALO_STRENGTH = 0.36;

// Coverage of a shape at this distance from its edge, antialiased over one pixel.
float coverage(float edgeDistance, float pixel) {
  return clamp(0.5 - edgeDistance / pixel, 0.0, 1.0);
}

// A line halfWidth either side of where offset is 0, never drawn thinner than THINNEST_PIXELS and
// dimmed by as much when widened, so a far corona's rim carries the same light rather than breaking up.
float line(float offset, float halfWidth, float pixel) {
  float drawn = max(halfWidth, 0.5 * THINNEST_PIXELS * pixel);
  return coverage(abs(offset) - drawn, pixel) * halfWidth / drawn;
}

vec3 screen(vec3 below, vec3 above) {
  return below + above - below * above;
}

// A steady pseudo-random number in [0, 1) for a whole number: the same one on every frame.
float hash(float seed) {
  return fract(sin(seed * 12.9898) * 43758.5453);
}

// The chips on the outer ring, rolling clockwise as his outer rim does: uneven, with gaps, some short
// ticks and some blocks, like the fragments on his limb rather than a dial's even marks.
float chips(vec2 point, float radius, float pixel) {
  float turn = (atan(point.y, point.x) + time * ROLL_RADIANS_PER_SECOND) / TAU * CHIPS;
  // Wrapped, so the place on either side of atan's seam at ±π is the same place.
  float place = mod(floor(turn), CHIPS);
  float present = step(0.38, hash(place + 1.0));
  float halfArc = 0.5 * mix(0.1, 0.42, hash(place + 31.0)) * TAU * CHIP_MIDDLE / CHIPS;
  float halfLength = mix(0.022, 0.07, hash(place + 67.0));
  float middle = CHIP_MIDDLE + (hash(place + 97.0) - 0.5) * 0.04;
  float across = abs(fract(turn) - 0.5) * TAU * radius / CHIPS;
  return present * line(across, halfArc, pixel) * coverage(abs(radius - middle) - halfLength, pixel);
}

// The band's line across the disc, broken into dashes as his strokes are: a new pattern each pass,
// up or down, since each pass reads a new slice.
float dashes(vec2 point, float scan, float pass, float pixel) {
  float place = floor(point.x / DASH_CELL);
  float chance = hash(place + 211.0 + pass * 7.0);
  float halfLength = 0.5 * mix(0.35, 0.95, chance) * DASH_CELL;
  float along = abs(fract(point.x / DASH_CELL) - 0.5) * DASH_CELL;
  return step(0.18, chance) * coverage(along - halfLength, pixel) * line(point.y - scan, DASH_HALF_WIDTH, pixel);
}

void main() {
  float radius = length(local);
  float pixel = max(length(fwidth(local)) * 0.70710678, 1e-6);

  // The band: level, from the bottom of its travel up to the top and back down, as his glides through
  // him — his scanAt, -cos(pi t / SCAN_SECONDS), over this disc's travel. Taken a whole swing at a
  // time first, so the cosine is never asked for a large angle, which some GPUs work out coarsely.
  float swing = mod(time, 2.0 * SCAN_SECONDS);
  float scan = -SCAN_TRAVEL * cos(PI * swing / SCAN_SECONDS);
  // How near it is, as a bell, as his light falls off.
  float apart = (local.y - scan) / SCAN_SOFTNESS;
  float nearness = exp(-apart * apart);
  float lit = mix(RIM_FLOOR, 1.0, nearness);
  float inside = 1.0 - smoothstep(0.86, 0.98, radius);

  // The halo round the rim, brighter where the band passes.
  // Squared by hand: GLSL leaves a negative number raised to a power undefined, and inside the rim
  // this is one.
  float fromRim = (radius - 1.0) / HALO_SPREAD;
  float haloShape = exp(-fromRim * fromRim);
  vec3 light = HALO * (HALO_STRENGTH * haloShape * mix(0.55, 1.0, nearness));

  // The rim, lit up where the band crosses it.
  light = screen(light, BRIGHT * (line(radius - 1.0, RIM_HALF, pixel) * lit));

  // The chips, dim, and brighter where the band passes them.
  light = screen(light, mix(DIM, BRIGHT, nearness) * (chips(local, radius, pixel) * mix(0.55, 1.0, nearness)));

  // The band itself across the disc: hot dashes with a glow either side, faded towards the rim. The
  // glow is the nearness squared, as his brightest specks are dealt, so it hugs the dashes.
  float band = dashes(local, scan, floor(time / SCAN_SECONDS), pixel);
  light = screen(light, HOT * (band * inside * 0.95));
  light = screen(light, HALO * (0.2 * nearness * nearness * inside));

  light *= fade;
  float brightest = max(light.r, max(light.g, light.b));
  if (brightest < 1.0 / 512.0) discard;
  colour = vec4(light, alphaFromLight * brightest);
}
`;function J(){let e=new E;e.setAttribute(`corner`,new k(new Float32Array([-1,-1,1,-1,1,1,-1,1]),2)),e.setIndex([0,1,2,0,2,3]);let t=new O(new Float32Array(96),3),n=new O(new Float32Array(32),1);t.setUsage(T),n.setUsage(T),e.setAttribute(`centre`,t),e.setAttribute(`level`,n),e.instanceCount=0;let r={eye:{value:new v},time:{value:0},alphaFromLight:{value:g}},i=new w({glslVersion:S,vertexShader:K,fragmentShader:q,uniforms:r,transparent:!0,depthTest:!1,depthWrite:!1,premultipliedAlpha:!0,blending:5,blendEquation:100,blendSrc:201,blendDst:203,blendEquationAlpha:100,blendSrcAlpha:201,blendDstAlpha:205}),a=new j(e,i);return a.frustumCulled=!1,a.renderOrder=5,a.visible=!1,{object:a,set(r){let i=Math.min(r.length,32);for(let e=0;e<i;e++){let i=r[e];i!==void 0&&(t.setXYZ(e,i.position.x,i.position.y,i.position.z),n.setX(e,Math.min(1,Math.max(0,i.level))))}t.needsUpdate=!0,n.needsUpdate=!0,e.instanceCount=i,a.visible=i>0},update(e,t){r.time.value+=e,r.eye.value.set(t.x,t.y,t.z)},get time(){return r.time.value},set time(e){r.time.value=e},get alphaFactor(){return r.alphaFromLight.value},set alphaFactor(e){r.alphaFromLight.value=e},dispose(){e.dispose(),i.dispose()}}}var Y=1500,X=-.5;function Z(e){let t=e.getContext(`2d`);if(t===null)throw Error(`This browser cannot draw text for the room.`);return t}function re(e,t,n,r,i,a){let o=Math.max(0,Math.min(a,r/2,i/2));e.beginPath(),e.moveTo(t+o,n),e.arcTo(t+r,n,t+r,n+i,o),e.arcTo(t+r,n+i,t,n+i,o),e.arcTo(t,n+i,t,n,o),e.arcTo(t,n,t+r,n,o),e.closePath()}function Q(e){return e/Y}function ie(e){return Math.round(e*Y)}function ae(e){return e+16}function oe(e,t){return e.premultiplyAlpha=!0,e.colorSpace=``,e.generateMipmaps=!0,e.minFilter=b,e.magFilter=C,e.anisotropy=Math.max(1,Math.floor(t)),e}function se(e,t){return oe(new x(e),t)}var ce={blending:5,blendEquation:100,blendSrc:201,blendDst:205,blendEquationAlpha:100,blendSrcAlpha:201,blendDstAlpha:205},le=`
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

in vec3 position;
in vec2 uv;

out vec2 canvasCoordinate;

void main() {
  canvasCoordinate = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,ue=`
precision highp float;

uniform sampler2D picture;

in vec2 canvasCoordinate;

out vec4 colour;

void main() {
  // Premultiplied, raw sRGB bytes, handed on as they are: the blend is premultiplied too.
  colour = texture(picture, canvasCoordinate, ${X.toFixed(2)});
}
`;function de(e){let t={picture:{value:e}},n=new w({glslVersion:S,vertexShader:le,fragmentShader:ue,uniforms:t,transparent:!0,depthTest:!1,depthWrite:!1,...ce});return Object.assign(n,{uniforms:t})}var $=1.15;function fe(e,t){let n=Array.from({length:8},(t,n)=>e[n]),r=[...new Set(t)].slice(0,8),i=n.flatMap((e,t)=>e===void 0||!r.includes(e)?[t]:[]),a=[];for(let e of r){if(n.includes(e))continue;let t=i.shift();if(t===void 0)break;n[t]=e,a.push(t)}return{held:n,slots:t.map(e=>{let t=n.indexOf(e);return t<0?7:t}),drawn:a}}function pe(e=document.createElement(`canvas`)){e.width=1024,e.height=128;let t=Z(e),n=new x(e);n.colorSpace=``,n.premultiplyAlpha=!0,n.minFilter=b,n.magFilter=C;let r=[],i=(e,n)=>{let r=64/$;t.setTransform(1,0,0,1,0,0),t.clearRect(e*128,0,128,128),t.setTransform(r,0,0,r,(e+.5)*128,64),t.lineWidth=c,t.lineCap=`round`,t.lineJoin=`round`,t.strokeStyle=`#ffffff`,t.stroke(new Path2D(n))};return{texture:n,slotsFor(e){let t=fe(r,e);r=t.held;for(let e of t.drawn){let t=r[e];t!==void 0&&i(e,t)}return t.drawn.length>0&&(n.needsUpdate=!0),t.slots},dispose(){n.dispose()}}}var me=.032,he=.55,ge=6,_e=`
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 eye;

in vec2 corner;
in vec3 centre;
in float level;
in float flare;
in float glyph;
in float asking;

out vec2 local;
flat out float fade;
flat out float flareOut;
flat out float glyphOut;
flat out float askingOut;

const float RADIUS = ${i(me)};
const float MIN_TANGENT = ${i(Math.tan(he*Math.PI/180))};
const float QUAD_REACH = ${i(1.9)};

void main() {
  vec3 toEye = eye - centre;
  float distance = length(toEye);
  vec3 front = distance > 1e-5 ? toEye / distance : vec3(0.0, 0.0, 1.0);
  vec3 up = vec3(0.0, 1.0, 0.0) - front * front.y;
  up = length(up) > 1e-3 ? normalize(up) : normalize(cross(front, vec3(1.0, 0.0, 0.0)));
  vec3 right = cross(up, front);
  float radius = max(RADIUS, distance * MIN_TANGENT);
  // Out from 6 radii, gone inside 3: a satellite at the end of the nose is in the way, not news.
  float near = clamp((distance / radius - 3.0) / 3.0, 0.0, 1.0);
  fade = level * near * near * (3.0 - 2.0 * near);
  flareOut = flare;
  glyphOut = glyph;
  askingOut = asking;
  local = corner * QUAD_REACH;
  vec3 world = centre + (right * local.x + up * local.y) * radius;
  gl_Position = fade > 0.0 ? projectionMatrix * modelViewMatrix * vec4(world, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`,ve=`
precision highp float;

uniform float time;
uniform float alphaFromLight;
// The glyphs, one slot each, side by side: see glyph-atlas.ts.
uniform sampler2D glyphs;

in vec2 local;
flat in float fade;
flat in float flareOut;
flat in float glyphOut;
flat in float askingOut;

out vec4 colour;

const vec3 HALO = ${a(h.colour)};
const vec3 BRIGHT = ${a(m.bright.colour)};
const vec3 HOT = ${a(m.hot.colour)};
const float THINNEST_PIXELS = ${i(u)};
const float ASKING_PULSE_SECONDS = ${i(ee)};
const float TAU = 6.283185307179586;

const float GLYPH_SLOTS = ${i(8)};
const float GLYPH_ATLAS_REACH = ${i($)};

float coverage(float edgeDistance, float pixel) {
  return clamp(0.5 - edgeDistance / pixel, 0.0, 1.0);
}

// A line halfWidth either side of offset 0, never thinner than THINNEST_PIXELS, dimmed when widened.
float line(float offset, float halfWidth, float pixel) {
  float drawn = max(halfWidth, 0.5 * THINNEST_PIXELS * pixel);
  return coverage(abs(offset) - drawn, pixel) * halfWidth / drawn;
}

vec3 screen(vec3 below, vec3 above) {
  return below + above - below * above;
}

// How much of the glyph in an atlas slot covers this point, in glyph radii from its middle, y up.
float glyphCoverage(vec2 point, float slot) {
  vec2 inSlot = 0.5 + point / (2.0 * GLYPH_ATLAS_REACH);
  if (any(lessThan(inSlot, vec2(0.0))) || any(greaterThan(inSlot, vec2(1.0)))) return 0.0;
  return texture(glyphs, vec2((slot + inSlot.x) / GLYPH_SLOTS, inSlot.y)).a;
}

void main() {
  float radius = length(local);
  float pixel = max(length(fwidth(local)) * 0.70710678, 1e-6);
  float pulse = askingOut > 0.5 ? mix(0.55, 1.0, 0.5 + 0.5 * cos(TAU * time / ASKING_PULSE_SECONDS)) : 1.0;

  // A little of his halo round it, brighter as it flares.
  vec3 light = HALO * (0.22 * exp(-radius * radius * 1.6) * (1.0 + 1.5 * flareOut));

  // The glyph, lit up by a flare.
  float stroke = glyphCoverage(local, floor(glyphOut + 0.5));
  light = screen(light, mix(BRIGHT, HOT, flareOut) * stroke * pulse);

  // A hot dot at its middle, as at his.
  light = screen(light, HOT * coverage(radius - 0.1, pixel) * mix(0.6, 1.0, flareOut));

  // The flare: a ring going out from the glyph as a tool is called, fading as it goes.
  if (flareOut > 0.0) {
    float ringRadius = mix(1.75, 0.8, flareOut);
    light = screen(light, HOT * line(radius - ringRadius, 0.035, pixel) * flareOut);
  }

  light *= fade;
  float brightest = max(light.r, max(light.g, light.b));
  if (brightest < 1.0 / 512.0) discard;
  colour = vec4(light, alphaFromLight * brightest);
}
`;function ye(e=pe()){let t=new E;t.setAttribute(`corner`,new k(new Float32Array([-1,-1,1,-1,1,1,-1,1]),2)),t.setIndex([0,1,2,0,2,3]);let n=new O(new Float32Array(24),3),r=new O(new Float32Array(8),1),i=new O(new Float32Array(8),1),a=new O(new Float32Array(8),1),o=new O(new Float32Array(8),1);for(let[e,s]of Object.entries({centre:n,level:r,flare:i,glyph:a,asking:o}))s.setUsage(T),t.setAttribute(e,s);t.instanceCount=0;let s={eye:{value:new v},time:{value:0},alphaFromLight:{value:g},glyphs:{value:e.texture}},c=new w({glslVersion:S,vertexShader:_e,fragmentShader:ve,uniforms:s,transparent:!0,depthTest:!1,depthWrite:!1,premultipliedAlpha:!0,blending:5,blendEquation:100,blendSrc:201,blendDst:203,blendEquationAlpha:100,blendSrcAlpha:201,blendDstAlpha:205}),l=new j(t,c);return l.frustumCulled=!1,l.renderOrder=ge,l.visible=!1,{object:l,set(s){let c=Math.min(s.length,8),u=e.slotsFor(s.slice(0,c).map(e=>e.glyph));for(let e=0;e<c;e++){let t=s[e];t!==void 0&&(n.setXYZ(e,t.position.x,t.position.y,t.position.z),r.setX(e,Math.min(1,Math.max(0,t.level))),i.setX(e,Math.min(1,Math.max(0,t.flare))),a.setX(e,u[e]??0),o.setX(e,+!!t.asking))}for(let e of[n,r,i,a,o])e.needsUpdate=!0;t.instanceCount=c,l.visible=c>0},update(e,t){s.time.value+=e,s.eye.value.set(t.x,t.y,t.z)},dispose(){t.dispose(),c.dispose(),e.dispose()}}}var be=1.75;function xe(e,t,n,r){let i=be*r;return d(e,t).map(({turn:e,reach:r,...a})=>{let{across:o,up:s,towards:c}=te({turn:e,reach:r},t);return{...a,position:{x:n.x+o*i,y:n.y+s*i,z:n.z+c*i}}})}function Se(){let e=ye(),t=o,n=[];return{object:e.object,activity(e){n.push(e)},conversationEnded(){n.push(`ended`)},update({time:i,deltaSeconds:a,eye:o,him:c,pretendWorking:l}){for(let e of n)t=e===`ended`?s(t,i):f(t,e,i);n=[],t=p(r(t,l,i),i),e.set(c===void 0?[]:xe(t,i,c.centre,c.radius)),e.update(a,o.position)},report:()=>l(t),dispose:()=>e.dispose()}}export{de as a,re as c,I as d,L as f,ne as g,P as h,ie as i,ae as l,N as m,Y as n,se as o,V as p,Q as r,Z as s,Se as t,J as u};