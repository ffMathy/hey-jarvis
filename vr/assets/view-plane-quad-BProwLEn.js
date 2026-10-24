import{$ as e,A as t,B as n,C as r,D as i,E as a,F as o,H as s,I as c,J as l,K as u,L as d,M as f,O as p,Q as m,S as h,T as g,X as _,Y as v,Z as y,et as ee,j as te,k as b,w as ne,x,z as S}from"./room-session-Bd5_1My8.js";import{F as C,R as w,T,d as E,g as D,k as O,y as k}from"./three-BmxjtmRs.js";function A(e){return e-Math.floor(e)}var j=13.7,M=3.91,N=7.7113,re=9.7;function ie(e){let t=e.body.length/10,n=e.stream.length/11,r=t+n,i={count:r,bodyCount:t,streamCount:n,rest:new Float32Array(r*4),shape:new Float32Array(r*4),hashes:new Float32Array(r*4),identity:new Float32Array(r*4),thinning:new Float32Array(r)};for(let n=0;n<t;n++)ae(i,n,e.body,n*10);for(let r=0;r<n;r++)oe(i,t+r,e.stream,r*11);return i}function ae(e,t,n,r){let i=n[r+6],a=t*4;e.rest.set([n[r],n[r+1],n[r+9],0],a),e.shape.set([n[r+2],n[r+3],n[r+4],n[r+5]],a),e.hashes.set([A(i*g),A(i*j),A(i*M),A(i*N)],a),e.identity.set([A(i*re),i,n[r+8],n[r+7]],a),e.thinning[t]=u(i)}function oe(e,t,n,r){let i=n[r+7],a=t*4;e.rest.set([n[r],n[r+1],n[r+2],1],a),e.shape.set([n[r+3],n[r+4],0,n[r+5]],a),e.hashes.set([n[r+6],A(i*j),A(i*M),A(i*N)],a);let o=n[r+8]+12*n[r+9];e.identity.set([0,i,n[r+10],o],a),e.thinning[t]=u(i)}var P={right:[1,0,0],up:[0,1,0],front:[0,0,1]};function F(e){return e>0?e>1?1:e:0}function se(e){let t=e<0?0:e>1?1:e;return t*t*(3-2*t)}function ce(e){return e-Math.floor(e)}function I(e,t){return e[0]*t[0]+e[1]*t[1]+e[2]*t[2]}function le(e,t,n,r){if(r.swirl>=1)return 1;let i=F(.9*Math.sqrt(e*e+t*t)+.1*ce(n*3.91));return .04+.96*se((r.swirl-.6*i)/.4)}function L(e){"worklet";return t*(1+i*e.hearingLevel*Math.sin(e.time*b))}var R=.816;function ue(e,t){return Number.isFinite(t)?t/Math.max(t-e,.1*t):1}function de(e,t,n,r,i,a){let o=i.hearing*p;if(o<=.001)return[e,t,n];let s=ue(n,a),c=i.listened;v(e*s,t*s,r,i,c);let l=L(i)*R,u=Math.floor(n/l+.5)*l,d=1/ue(u,a);return[e+(c[0]*d-e)*o,t+(c[1]*d-t)*o,n+(u-n)*o]}function fe(e,t,n,r){let i=e-x,a=t-h;return[x+i*n-a*r,h+i*r+a*n]}function z(e,t,n,r){let{right:i,up:a,front:o}=e;return[t*i[0]-n*a[0]+r*o[0],t*i[1]-n*a[1]+r*o[1],t*i[2]-n*a[2]+r*o[2]]}function pe(e,t,n){let{x:r,y:i,axisX:a,axisY:o}=e,s=-o*.55,c=a*.55,l=[r,i];if(e.group===1){let e=t.shellTurn*Math.PI/180,n=Math.cos(e),l=Math.sin(e);[r,i]=fe(r,i,n,l),[a,o]=[a*n-o*l,a*l+o*n],[s,c]=[s*n-c*l,s*l+c*n]}return{centre:z(n,r,i,e.depth),axis:z(n,a,o,e.axisDepth),normal:z(n,s,c,0),tier:e.tier,glyph:e.glyph,group:e.group,plane:l}}function me(e,t,n,r,i=1/0){let o=n.reading,s=_(e,t,n,o);if(s<=0)return null;let[c=0,u=0,d=0,f=0]=[o[1],o[2],o[3],o[4]],p=e[t],h=e[t+1],g=e[t+2],v=e[t+3],y=e[t+4],b=e[t+6],ne=e[t+9],x=ce(d*.618034+b*9.7),S=(x-.5)*1.4*y,C=F((.76-(p*p+h*h))*3.2),w=(ce(x*23.17)-.5)*(a+1.3*n.agitation*C),T=[p*n.bodyCos+ne*n.bodySin,-h,ne*n.bodyCos-p*n.bodySin],E=I(T,r.right),D=-I(T,r.up),O=I(T,r.front),k=D+v*S+g*w,A=E+g*S-v*w,j=s*F((.94*.94-E*E-k*k)*8);if(j<.1)return null;ee(A,k,g,v,b,n);let[M=0,N=0,re=0,ie=0,ae=0]=n.swirled;if(ae<=0)return null;let[oe,P,se]=de(M,N,O*le(A,k,b,n),b,n,i),L=j*m(-z(r,oe,P,se)[1],n);if(L<.1)return null;let R=O>=0,ue=R?l(f,L,b,n.hotShare):0,fe=y*.5*L*ae*(1-te*n.hearing);return pe({x:oe,y:P,depth:se,axisX:re*fe,axisY:ie*fe,axisDepth:0,tier:n.scanBright[0]>0&&R?2:ue,glyph:c,group:+(u>0)},n,r)}function he(e,t,n,r,i=1/0){let a=y(e,t,n);if(a<=0)return null;let o=n.reading[0],s=e[t],c=e[t+1],u=e[t+2],d=e[t+3],f=e[t+4],p=e[t+7],m=[s*n.streamCos+u*n.streamSin,-c,u*n.streamCos-s*n.streamSin],h=I(m,r.right),g=-I(m,r.up),_=I(m,r.front),v=a*F((.86-h*h-g*g)*8);if(v<.1)return null;let b=[d*n.streamCos+f*n.streamSin,0,f*n.streamCos-d*n.streamSin],ne=_<0?0:l(e[t+8]-3*o,v,p,n.hotShare);ee(h,g,1,0,p,n);let[x=0,S=0,C=0,w=0,T=0]=n.swirled;if(T<=0)return null;let[E,D,O]=de(x,S,_*le(h,g,p,n),p,n,i),k=I(b,r.right)<0?-1:1,A=k*I(b,r.right),j=-k*I(b,r.up),M=k*I(b,r.front),N=v*T*(1-te*n.hearing);return pe({x:E,y:D,depth:O,axisX:(A*C-j*w)*N,axisY:(A*w+j*C)*N,axisDepth:M*N,tier:ne,glyph:e[t+9],group:0},n,r)}function B(e){let t=String(e);return/[.e]/.test(t)?t:`${t}.0`}function V(e){let t=t=>B((e>>t&255)/255);return`vec3(${t(16)}, ${t(8)}, ${t(0)})`}function ge(){return{time:{value:0},bodyShare:{value:1},mixShare:{value:0},hotShare:{value:1},agitation:{value:0},swirl:{value:1},hearing:{value:0},thinking:{value:0},scanHeight:{value:0},density:{value:1},bodyTurn:{value:[1,0]},streamTurn:{value:[1,0]},shellTurn:{value:[1,0]},lattice:{value:[1,0,.11,0]},viewRight:{value:[1,0,0]},viewUp:{value:[0,1,0]},viewFront:{value:[0,0,1]},eyeDistance:{value:_e}}}var _e=1e5;function ve(e,t,n,r,i){"worklet";e.time.value=t.time,e.bodyShare.value=t.bodyShare,e.mixShare.value=t.mix,e.hotShare.value=t.hotShare,e.agitation.value=t.agitation,e.swirl.value=t.swirl,e.hearing.value=t.hearing,e.thinking.value=t.thinking,e.scanHeight.value=t.scan,e.density.value=r,e.bodyTurn.value=[t.bodyCos,t.bodySin],e.streamTurn.value=[t.streamCos,t.streamSin];let a=t.shellTurn*Math.PI/180;e.shellTurn.value=[Math.cos(a),Math.sin(a)];let o=t.time*f;e.lattice.value=[Math.cos(o),Math.sin(o),L(t),t.hearing*p],e.viewRight.value=n.right,e.viewUp.value=n.up,e.viewFront.value=n.front,e.eyeDistance.value=Number.isFinite(i)?i:_e}var ye=`
uniform float time;
uniform float bodyShare;
uniform float mixShare;
uniform float hotShare;
uniform float agitation;
uniform float swirl;
uniform float hearing;
uniform float thinking;
uniform float scanHeight;
uniform float density;
uniform vec2 bodyTurn;
uniform vec2 streamTurn;
uniform vec2 shellTurn;
uniform vec4 lattice;
uniform vec3 viewRight;
uniform vec3 viewUp;
uniform vec3 viewFront;
// How far the centre eye is from his centre, in the drawing's unit.
uniform float eyeDistance;

// One row of body-rows.ts.
in vec4 rest;
in vec4 shape;
in vec4 hashes;
in vec4 identity;
in float thinning;

const float DUTY = ${B(r)};
const float FAINTEST = ${B(ne)};
const float WANDER = ${B(a)};
const float SCAN_HALF_WIDTH = ${B(d)};
const float SCAN_FLOOR = ${B(c)};
const float SCAN_BRIGHT_NEARNESS = ${B(o)};
const float STROKE_SHRINK = ${B(te)};
const float VORTEX_TWIST = ${B(s)};
const float VORTEX_STRETCH = ${B(4)};
const float LAYER_SHARE = ${B(R)};
const vec2 CORE = vec2(${B(x)}, ${B(h)});

struct Fragment {
  bool visible;
  // Its middle, half its length along it and the glyph's normal, in the body's frame.
  vec3 centre;
  vec3 axis;
  vec3 normal;
  float tier;
  float glyph;
  float group;
  // Where it is in the view plane, and its half-length there, before the inner layer's turn.
  vec2 plane;
  vec2 planeAxis;
};

Fragment hiddenFragment() {
  return Fragment(false, vec3(0.0), vec3(0.0), vec3(0.0), 0.0, 0.0, 0.0, vec2(0.0), vec2(0.0));
}

float clamp01(float value) {
  return clamp(value, 0.0, 1.0);
}

float smooth01(float value) {
  float clamped = clamp(value, 0.0, 1.0);
  return clamped * clamped * (3.0 - 2.0 * clamped);
}

// JavaScript's Math.round: halves go up.
float roundHalfUp(float value) {
  return floor(value + 0.5);
}

float fragmentShown(float revealOrder) {
  return clamp01((bodyShare * 1.12 - revealOrder) * 9.0);
}

float fragmentStrength(float life, float id, float pool) {
  float progress = life / DUTY;
  float envelope = min(1.0, min(progress * 3.0, (1.0 - progress) * 3.0));
  float poolShare = pool < 0.5 ? clamp01((id - mixShare) * 12.0 + 1.0) : clamp01((2.0 * mixShare - id) * 12.0);
  return envelope * poolShare;
}

float fragmentTier(float brightness, float strength, float hot) {
  if (brightness > 1.5) {
    if (strength <= 0.55) return 1.0;
    float margin = hotShare - hot;
    if (margin > 0.0) return 2.0;
    if (margin > -0.12 && strength > 0.86) return 2.0;
    return 1.0;
  }
  if (brightness > 0.5 && strength > 0.4) return 1.0;
  return 0.0;
}

// swirlFragment: the place (xy) and direction (zw), how much of it shows, and the scale its place
// was brought in by, which the depth is scaled by too.
vec4 swirlFragment(vec2 point, vec2 unit, float orderHash, out float shown, out float scale) {
  if (swirl >= 1.0) {
    shown = 1.0;
    scale = 1.0;
    return vec4(point, unit);
  }
  float order = clamp01(0.9 * length(point) + 0.1 * orderHash);
  float travelled = smooth01((swirl - 0.6 * order) / 0.4);
  float left = 1.0 - travelled;
  float spin = VORTEX_TWIST * left * left;
  float cosine = cos(spin);
  float sine = sin(spin);
  scale = 0.04 + 0.96 * travelled;
  vec2 swirled = vec2(point.x * cosine + point.y * sine, point.y * cosine - point.x * sine) * scale;
  float reach = length(swirled);
  if (reach == 0.0) reach = 1.0;
  vec2 outward = swirled / reach;
  vec2 heading = vec2(0.35 * outward.x - outward.y, 0.35 * outward.y + outward.x);
  heading /= length(heading);
  float settled = travelled * travelled;
  vec2 direction = heading * (1.0 - settled)
    + vec2(unit.x * cosine + unit.y * sine, unit.y * cosine - unit.x * sine) * settled;
  float directionLength = length(direction);
  if (directionLength == 0.0) directionLength = 1.0;
  float stretch = 1.0 + VORTEX_STRETCH * left * clamp01(reach * 2.5);
  shown = smooth01((travelled - 0.04) * 6.0) * stretch;
  return vec4(swirled, direction / directionLength);
}

// How much larger than on the plane through his centre the centre eye sees what is depth nearer.
float seenLarger(float depth) {
  return eyeDistance / max(eyeDistance - depth, 0.1 * eyeDistance);
}

// The lattice point for where the centre eye sees the fragment, the depth pulled as far into the
// nearest layer, and the fragment put where the eye sees it on that point from its layer.
vec3 onLattice(vec2 point, float depth, float jitterHash) {
  float pull = lattice.w;
  if (pull <= 0.001) return vec3(point, depth);
  float cosine = lattice.x;
  float sine = lattice.y;
  float spacing = lattice.z;
  vec2 seen = point * seenLarger(depth);
  vec2 local = vec2(seen.x * cosine + seen.y * sine, seen.y * cosine - seen.x * sine);
  float rowHeight = spacing * 0.866;
  float row = roundHalfUp(local.y / rowHeight);
  float shift = mod(row, 2.0) == 0.0 ? 0.0 : spacing / 2.0;
  float column = roundHalfUp((local.x - shift) / spacing);
  float jitter = (jitterHash - 0.5) * 0.018;
  vec2 snapped = vec2(column * spacing + shift + jitter, row * rowHeight + jitter);
  vec2 target = vec2(snapped.x * cosine - snapped.y * sine, snapped.y * cosine + snapped.x * sine);
  float layer = spacing * LAYER_SHARE;
  float snappedDepth = roundHalfUp(depth / layer) * layer;
  vec2 placed = target / seenLarger(snappedDepth);
  return vec3(point + (placed - point) * pull, depth + (snappedDepth - depth) * pull);
}

float scanned(float heightDown, out bool bright) {
  if (thinking <= 0.0) {
    bright = false;
    return 1.0;
  }
  float nearness = clamp01(1.0 - abs(heightDown - scanHeight) / SCAN_HALF_WIDTH);
  bright = nearness > SCAN_BRIGHT_NEARNESS && thinking > 0.5;
  return 1.0 - thinking * (1.0 - SCAN_FLOOR) * (1.0 - nearness * nearness);
}

vec2 turnVector(vec2 vector) {
  return vec2(vector.x * shellTurn.x - vector.y * shellTurn.y, vector.x * shellTurn.y + vector.y * shellTurn.x);
}

vec3 intoBody(vec2 point, float depth) {
  return point.x * viewRight - point.y * viewUp + depth * viewFront;
}

Fragment finishFragment(vec3 placed, vec2 axis, float axisDepth, float tier, float glyph, float group) {
  Fragment fragment = hiddenFragment();
  fragment.visible = true;
  fragment.plane = placed.xy;
  fragment.planeAxis = axis;
  vec2 point = placed.xy;
  vec2 normal = vec2(-axis.y, axis.x) * 0.55;
  if (group > 0.5) {
    point = CORE + turnVector(point - CORE);
    axis = turnVector(axis);
    normal = turnVector(normal);
  }
  fragment.centre = intoBody(point, placed.z);
  fragment.axis = intoBody(axis, axisDepth);
  fragment.normal = intoBody(normal, 0.0);
  fragment.tier = tier;
  fragment.glyph = glyph;
  fragment.group = group;
  return fragment;
}

Fragment readBodyFragment() {
  float id = identity.y;
  float cycles = time * shape.w + hashes.x;
  float cycle = floor(cycles);
  float life = cycles - cycle;
  if (life >= DUTY) return hiddenFragment();
  float shown = fragmentShown(identity.z);
  if (shown <= 0.0) return hiddenFragment();
  // brightness + 3 × pool + 6 × turning + 12 × glyph, taken apart exactly in integers.
  int code = int(identity.w + 0.5);
  int glyph = code / 12;
  int kind = code - 12 * glyph;
  int group = kind / 6;
  int pool = (kind - 6 * group) / 3;
  float brightness = float(kind - 6 * group - 3 * pool);
  float strength = shown * fragmentStrength(life, id, float(pool));
  if (strength < FAINTEST) return hiddenFragment();

  vec2 unit = shape.xy;
  float fragmentLength = shape.z;
  float hop = fract(cycle * 0.618034 + identity.x);
  float along = (hop - 0.5) * 1.4 * fragmentLength;
  float inward = clamp01((0.76 - dot(rest.xy, rest.xy)) * 3.2);
  float across = (fract(hop * 23.17) - 0.5) * (WANDER + 1.3 * agitation * inward);
  vec3 turned = vec3(rest.x * bodyTurn.x + rest.z * bodyTurn.y, -rest.y, rest.z * bodyTurn.x - rest.x * bodyTurn.y);
  float planeX = dot(turned, viewRight);
  float planeY = -dot(turned, viewUp);
  float depth = dot(turned, viewFront);
  float y = planeY + unit.y * along + unit.x * across;
  float x = planeX + unit.x * along - unit.y * across;
  float lit = strength * clamp01((0.94 * 0.94 - planeX * planeX - y * y) * 8.0);
  if (lit < FAINTEST) return hiddenFragment();

  float drawn;
  float scale;
  vec4 swirled = swirlFragment(vec2(x, y), unit, hashes.z, drawn, scale);
  if (drawn <= 0.0) return hiddenFragment();
  vec3 placed = onLattice(swirled.xy, depth * scale, hashes.w);
  bool scanBright;
  float litHere = lit * scanned(-intoBody(placed.xy, placed.z).y, scanBright);
  if (litHere < FAINTEST) return hiddenFragment();
  bool facing = depth >= 0.0;
  float plain = facing ? fragmentTier(brightness, litHere, hashes.y) : 0.0;
  float tier = scanBright && facing ? 2.0 : plain;
  float halfLength = fragmentLength * 0.5 * litHere * drawn * (1.0 - STROKE_SHRINK * hearing);
  return finishFragment(placed, swirled.zw * halfLength, 0.0, tier, float(glyph), float(group));
}

Fragment readStreamFragment() {
  float id = identity.y;
  float cycles = time * shape.w + hashes.x;
  float life = cycles - floor(cycles);
  if (life >= DUTY) return hiddenFragment();
  float shown = fragmentShown(identity.z);
  if (shown <= 0.0) return hiddenFragment();
  int code = int(identity.w + 0.5);
  int glyph = code / 12;
  int kind = code - 12 * glyph;
  int pool = kind >= 3 ? 1 : 0;
  float brightness = float(kind - 3 * pool);
  float strength = shown * fragmentStrength(life, id, float(pool));
  if (strength < FAINTEST) return hiddenFragment();

  vec3 turned = vec3(
    rest.x * streamTurn.x + rest.z * streamTurn.y,
    -rest.y,
    rest.z * streamTurn.x - rest.x * streamTurn.y
  );
  float planeX = dot(turned, viewRight);
  float planeY = -dot(turned, viewUp);
  float depth = dot(turned, viewFront);
  float lit = strength * clamp01((0.86 - planeX * planeX - planeY * planeY) * 8.0);
  if (lit < FAINTEST) return hiddenFragment();
  vec3 tangent = vec3(
    shape.x * streamTurn.x + shape.y * streamTurn.y,
    0.0,
    shape.y * streamTurn.x - shape.x * streamTurn.y
  );
  float tier = depth < 0.0 ? 0.0 : fragmentTier(brightness, lit, hashes.y);

  float drawn;
  float scale;
  vec4 swirled = swirlFragment(vec2(planeX, planeY), vec2(1.0, 0.0), hashes.z, drawn, scale);
  if (drawn <= 0.0) return hiddenFragment();
  vec3 placed = onLattice(swirled.xy, depth * scale, hashes.w);
  float rightwards = dot(tangent, viewRight) < 0.0 ? -1.0 : 1.0;
  vec2 tangentPlane = rightwards * vec2(dot(tangent, viewRight), -dot(tangent, viewUp));
  float tangentDepth = rightwards * dot(tangent, viewFront);
  float size = lit * drawn * (1.0 - STROKE_SHRINK * hearing);
  vec2 direction = swirled.zw;
  vec2 axis = vec2(
    tangentPlane.x * direction.x - tangentPlane.y * direction.y,
    tangentPlane.x * direction.y + tangentPlane.y * direction.x
  ) * size;
  return finishFragment(placed, axis, tangentDepth * size, tier, float(glyph), 0.0);
}

Fragment readFragment() {
  // Rows are in the density share's order, so a share keeps the ones whose key is under it.
  if (thinning >= density) return hiddenFragment();
  // An if rather than ?:, which WebGL does not allow on structures.
  if (rest.w < 0.5) return readBodyFragment();
  return readStreamFragment();
}
`,H=`
float segmentDistance(vec2 point, vec2 from, vec2 to) {
  vec2 run = to - from;
  float lengthSquared = dot(run, run);
  float along = lengthSquared > 0.0 ? clamp(dot(point - from, run) / lengthSquared, 0.0, 1.0) : 0.0;
  return length(point - from - run * along);
}

float boxDistance(vec2 point, vec2 halfSize) {
  vec2 outside = abs(point) - halfSize;
  return length(max(outside, 0.0)) + min(max(outside.x, outside.y), 0.0);
}

// A butt-capped stroke of half-width w along one segment: a box, which draws nothing when the
// segment has no length, as Skia's butt cap does.
float buttDistance(vec2 point, vec2 from, vec2 to, float halfWidth) {
  vec2 run = to - from;
  float runLength = length(run);
  if (runLength < 1e-7) return 1e3;
  vec2 direction = run / runLength;
  vec2 fromMiddle = point - 0.5 * (from + to);
  vec2 local = vec2(dot(fromMiddle, direction), dot(fromMiddle, vec2(-direction.y, direction.x)));
  return boxDistance(local, vec2(0.5 * runLength, halfWidth));
}

// Distance to the glyph's centre line: what a round-capped stroke — a halo, a hot core — is
// measured from.
float glyphLineDistance(vec2 point, float glyph, float h, float n) {
  int kind = int(glyph + 0.5);
  if (kind == 5) return abs(length(point) - 0.45 * h);
  if (kind == 6) return abs(boxDistance(point, vec2(h, n)));
  float nearest = segmentDistance(point, vec2(-h, 0.0), vec2(h, 0.0));
  if (kind == 1) {
    nearest = min(nearest, segmentDistance(point, vec2(h, 0.0), vec2(h, n)));
  } else if (kind == 2) {
    nearest = min(nearest, segmentDistance(point, vec2(-h, n), vec2(-h, 0.0)));
    nearest = min(nearest, segmentDistance(point, vec2(h, 0.0), vec2(h, n)));
  } else if (kind == 3) {
    nearest = min(nearest, segmentDistance(point, vec2(0.0), vec2(0.0, 1.4 * n)));
  } else if (kind == 4) {
    nearest = min(nearest, segmentDistance(point, vec2(-h, n), vec2(-h, 0.0)));
    nearest = min(nearest, segmentDistance(point, vec2(h, 0.0), vec2(h, -n)));
  }
  return nearest;
}

// Signed distance to the glyph stroked butt-capped at half-width w, as the body's tiers are.
float glyphStrokeDistance(vec2 point, float glyph, float h, float n, float halfWidth) {
  int kind = int(glyph + 0.5);
  if (kind == 5) return abs(length(point) - 0.45 * h) - halfWidth;
  if (kind == 6) return abs(boxDistance(point, vec2(h, n))) - halfWidth;
  float nearest = buttDistance(point, vec2(-h, 0.0), vec2(h, 0.0), halfWidth);
  if (kind == 1) {
    nearest = min(nearest, buttDistance(point, vec2(h, 0.0), vec2(h, n), halfWidth));
  } else if (kind == 2) {
    nearest = min(nearest, buttDistance(point, vec2(-h, n), vec2(-h, 0.0), halfWidth));
    nearest = min(nearest, buttDistance(point, vec2(h, 0.0), vec2(h, n), halfWidth));
  } else if (kind == 3) {
    nearest = min(nearest, buttDistance(point, vec2(0.0), vec2(0.0, 1.4 * n), halfWidth));
  } else if (kind == 4) {
    nearest = min(nearest, buttDistance(point, vec2(-h, n), vec2(-h, 0.0), halfWidth));
    nearest = min(nearest, buttDistance(point, vec2(h, 0.0), vec2(h, -n), halfWidth));
  }
  return nearest;
}

// How far along and across the glyph reaches from its middle: what its quad has to cover.
vec2 glyphReach(float glyph, float h, float n) {
  int kind = int(glyph + 0.5);
  if (kind == 5) return vec2(0.45 * h);
  if (kind == 0) return vec2(h, 0.0);
  if (kind == 3) return vec2(h, 1.4 * n);
  return vec2(h, n);
}
`,be=64*n;function xe(t){return e(t.textureSeed^S)}var U={dim:{colour:13397548,width:.014,alpha:.62},mid:{colour:16281638,width:.0155,alpha:.85},bright:{colour:16743976,width:.0165,alpha:1},hot:{colour:16748092,width:.007,alpha:.8}},Se=1.2,Ce=`
precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
// The height of the viewport being drawn, in pixels, and how many metres the drawing's unit is.
uniform float viewportHeight;
uniform float unitMetres;

in vec2 corner;

${ye}
${H}

// Where this corner is in the glyph's own frame — along it, across it — in the drawing's unit.
out vec2 local;
// Where it is in the view plane before the inner layer's turn, which is where the sparkle is read.
out vec2 sparklePoint;
// The glyph, its half-length, its normal's length and its tier.
flat out vec4 glyphShape;

const float WIDEST_HALF_STROKE = ${B(U.bright.width/2)};
const float THINNEST_PIXELS = ${B(Se)};

void main() {
  Fragment fragment = readFragment();
  if (!fragment.visible) {
    // Past the far plane, so nothing of it is drawn.
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float halfLength = length(fragment.axis);
  vec3 along = halfLength > 1e-7 ? fragment.axis / halfLength : viewRight;
  // Square to the stroke in the view plane, on the side the drawing's glyphs put their ticks.
  vec3 across = normalize(cross(along, viewFront));
  float normalLength = length(fragment.normal);
  vec2 reach = glyphReach(fragment.glyph, halfLength, normalLength);

  // How big a pixel is where the fragment is, in the drawing's unit, so the quad is wide enough for
  // the stroke however far away it is, with room for its antialiased edge.
  vec4 clipCentre = projectionMatrix * modelViewMatrix * vec4(fragment.centre, 1.0);
  float pixel = 2.0 * abs(clipCentre.w) / (projectionMatrix[1][1] * viewportHeight * unitMetres);
  float margin = max(WIDEST_HALF_STROKE, 0.5 * THINNEST_PIXELS * pixel) + 1.5 * pixel;
  local = corner * (reach + margin);

  float planeLength = length(fragment.planeAxis);
  vec2 planeAlong = planeLength > 1e-7 ? fragment.planeAxis / planeLength : vec2(1.0, 0.0);
  sparklePoint = fragment.plane + planeAlong * local.x + vec2(-planeAlong.y, planeAlong.x) * local.y;
  glyphShape = vec4(fragment.glyph, halfLength, normalLength, fragment.tier);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(fragment.centre + along * local.x + across * local.y, 1.0);
}
`,we=`
precision highp float;
precision highp int;

uniform sampler2D sparkle;
uniform float agitation;
// How much of what is behind his light it hides; the fades are the blend's.
uniform float alphaFromLight;

in vec2 local;
in vec2 sparklePoint;
flat in vec4 glyphShape;

out vec4 colour;

${H}

const vec3 DIM = ${V(U.dim.colour)};
const vec3 MID = ${V(U.mid.colour)};
const vec3 BRIGHT = ${V(U.bright.colour)};
const vec3 HOT = ${V(U.hot.colour)};
const float THINNEST_PIXELS = ${B(Se)};
const float SPARKLE_REPEAT = ${B(be)};

// Coverage of a shape at this distance from its edge, antialiased over one pixel.
float coverage(float edgeDistance, float pixel) {
  return clamp(0.5 - edgeDistance / pixel, 0.0, 1.0);
}

void main() {
  float glyph = glyphShape.x;
  float halfLength = glyphShape.y;
  float normalLength = glyphShape.z;
  float tier = glyphShape.w;
  float pixel = max(length(fwidth(local)) * 0.70710678, 1e-6);
  float sparkleLevel = texture(sparkle, sparklePoint / SPARKLE_REPEAT).r;

  vec3 paint = DIM;
  float halfWidth = ${B(U.dim.width/2)};
  float strength = ${B(U.dim.alpha)};
  if (tier > 1.5) {
    paint = BRIGHT * sparkleLevel;
    halfWidth = ${B(U.bright.width/2)};
    strength = 1.0 - 0.25 * agitation;
  } else if (tier > 0.5) {
    paint = MID * sparkleLevel;
    halfWidth = ${B(U.mid.width/2)};
    strength = ${B(U.mid.alpha)};
  }
  float drawnHalf = max(halfWidth, 0.5 * THINNEST_PIXELS * pixel);
  strength *= halfWidth / drawnHalf;
  vec3 light = paint * strength * coverage(glyphStrokeDistance(local, glyph, halfLength, normalLength, drawnHalf), pixel);

  if (tier > 1.5) {
    float hotHalf = ${B(U.hot.width/2)};
    float drawnHot = max(hotHalf, 0.5 * THINNEST_PIXELS * pixel);
    float hotStrength = ${B(U.hot.alpha)} * (1.0 - 0.95 * agitation) * hotHalf / drawnHot;
    float hotDistance = glyphLineDistance(local, glyph, halfLength, normalLength) - drawnHot;
    vec3 hot = HOT * sparkleLevel * hotStrength * coverage(hotDistance, pixel);
    // Screen, as the phone lays the hot core over the bright stroke.
    light = light + hot - light * hot;
  }
  float brightest = max(light.r, max(light.g, light.b));
  if (brightest <= 0.0) discard;
  colour = vec4(light, alphaFromLight * brightest);
}
`,Te=.52,W={colour:14441504,dim:{width:.115,strength:.3*Te},mid:{width:.12,strength:.34*Te},bright:{width:.115,strength:.38*Te}},Ee=`
precision highp float;
precision highp int;

// One texel, in the drawing's unit, and his radius as a share of the square the target covers.
uniform float texelUnits;
uniform float radiusFraction;

in vec2 corner;

${ye}
${H}

out vec2 local;
flat out vec4 glyphShape;
flat out float haloRadius;

void main() {
  Fragment fragment = readFragment();
  if (!fragment.visible) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  // Onto the plane through his centre as the centre eye sees it.
  float depth = dot(fragment.centre, viewFront);
  float perspective = seenLarger(depth);
  vec2 centre = vec2(dot(fragment.centre, viewRight), -dot(fragment.centre, viewUp)) * perspective;
  vec2 axis = vec2(dot(fragment.axis, viewRight), -dot(fragment.axis, viewUp)) * perspective;
  float halfLength = length(axis);
  vec2 along = halfLength > 1e-7 ? axis / halfLength : vec2(1.0, 0.0);
  vec2 across = vec2(-along.y, along.x);
  float normalLength = length(fragment.normal) * perspective;
  haloRadius = 0.5 * (fragment.tier > 0.5 && fragment.tier < 1.5 ? ${B(W.mid.width)} : ${B(W.dim.width)}) * perspective;
  local = corner * (glyphReach(fragment.glyph, halfLength, normalLength) + haloRadius + 1.5 * texelUnits);
  glyphShape = vec4(fragment.glyph, halfLength, normalLength, fragment.tier);

  // Into the target: the pinned half on the left, the turning half on the right, y up as a
  // texture's rows go.
  vec2 point = centre + along * local.x + across * local.y;
  vec2 share = vec2(0.5 + point.x * radiusFraction, 0.5 - point.y * radiusFraction);
  gl_Position = vec4(share.x - 1.0 + fragment.group, 2.0 * share.y - 1.0, 0.0, 1.0);
}
`,De=`
precision highp float;
precision highp int;

in vec2 local;
flat in vec4 glyphShape;
flat in float haloRadius;

out vec4 colour;

${H}

void main() {
  float texel = max(length(fwidth(local)) * 0.70710678, 1e-6);
  float edgeDistance = glyphLineDistance(local, glyphShape.x, glyphShape.y, glyphShape.z) - haloRadius;
  float covered = clamp(0.5 - edgeDistance / texel, 0.0, 1.0);
  if (covered <= 0.0) discard;
  float tier = glyphShape.w;
  colour = vec4(tier < 0.5 ? covered : 0.0, tier > 0.5 && tier < 1.5 ? covered : 0.0, tier > 1.5 ? covered : 0.0, 0.0);
}
`;function Oe(e,t,n=512){"worklet";return t.radiusFraction=e,t.texelUnits=1/(e*n),t}var ke=`
uniform sampler2D halo;
// The halo tiers' strengths (dim, mid, bright) times the voice's glow; all 0 with no halo pass.
uniform vec3 haloShares;

const vec3 HALO = ${V(W.colour)};

// What is left of the light behind once one tier's halo is Screened over it.
vec3 through(float covered, float share) {
  return vec3(1.0) - HALO * (share * covered);
}

// The halo union's two groups, each tier Screened over the rest as the phone's paths are.
vec3 haloGlow(vec2 coordinate) {
  vec3 pinned = texture(halo, vec2(coordinate.x * 0.5, coordinate.y)).rgb;
  vec3 turning = texture(halo, vec2(0.5 + coordinate.x * 0.5, coordinate.y)).rgb;
  vec3 left = through(pinned.r, haloShares.x) * through(pinned.g, haloShares.y) * through(pinned.b, haloShares.z)
    * through(turning.r, haloShares.x) * through(turning.g, haloShares.y) * through(turning.b, haloShares.z);
  return vec3(1.0) - left;
}
`;function Ae(e,t){"worklet";return t[0]=W.dim.strength*e,t[1]=W.mid.strength*e,t[2]=W.bright.strength*e,t}var je=`
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 viewRight;
uniform vec3 viewUp;
uniform float halfSide;

in vec2 corner;

out vec2 haloCoordinate;

void main() {
  haloCoordinate = corner * 0.5 + 0.5;
  vec3 position = (corner.x * viewRight + corner.y * viewUp) * halfSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,Me=`
precision highp float;

uniform float alphaFromLight;

in vec2 haloCoordinate;

out vec4 colour;

${ke}

void main() {
  vec3 glow = haloGlow(haloCoordinate);
  colour = vec4(glow, alphaFromLight * max(glow.r, max(glow.g, glow.b)));
}
`,Ne=[-1,-1,1,-1,1,1,-1,1],G=[0,1,2,0,2,3],Pe=65535,Fe=[[`rest`,4],[`shape`,4],[`hashes`,4],[`identity`,4],[`thinning`,1]];function Ie(e,t){let n=e.length/t,r=new Float32Array(e.length*4);for(let i=0;i<n;i++){let n=e.subarray(i*t,(i+1)*t);for(let e=0;e<4;e++)r.set(n,(i*4+e)*t)}return r}function Le(e){let t=Fe.map(([t,n])=>({name:t,size:n,values:Ie(e[t],n)})),n=new Float32Array(e.count*Ne.length);for(let t=0;t<e.count;t++)n.set(Ne,t*Ne.length);let r=e.count*4,i=e.count*G.length,a=r<=Pe?new Uint16Array(i):new Uint32Array(i);for(let t=0;t<e.count;t++)for(let e=0;e<G.length;e++)a[t*G.length+e]=t*4+G[e];return{vertexCount:r,attributes:t,corner:n,index:a}}var Re=35633,ze=35632,Be=35713,Ve=35714,K=34962,He=34963,Ue=35044,We=5126,Ge=5121,Ke=5123,qe=5125,Je=4,q=3553,Ye=33984,Xe=6408,Ze=32856,Qe=10240,$e=10241,et=10242,tt=10243,nt=9729,rt=10497,it=33071,J=36160,at=36064,ot=36053,st=16384,ct=3042,lt=2884,ut=2929,dt=2960,ft=3089,pt=3024,mt=32774,ht=32776,Y=1,gt=769,_t=771,vt=32769,yt=32771,bt=new Float32Array([-1,1,1,1,-1,-1,1,-1]),xt=new Uint16Array([0,2,1,2,3,1]),X=Object.keys(ge()),St=[...X,`texelUnits`,`radiusFraction`],Ct=[...X,`modelViewMatrix`,`projectionMatrix`,`viewportHeight`,`unitMetres`,`sparkle`,`alphaFromLight`],wt=[`modelViewMatrix`,`projectionMatrix`,`viewRight`,`viewUp`,`halfSide`,`halo`,`haloShares`,`alphaFromLight`];function Z(e){return`id`in e&&typeof e.id==`number`?{id:e.id}:e}function Tt(e,t,n){let r=e.createShader(t);if(r===null)throw Error(`The GPU body could not make a shader.`);if(e.shaderSource(r,`#version 300 es\n${n}`),e.compileShader(r),e.getShaderParameter(r,Be)!==!0){let t=e.getShaderInfoLog(r);throw e.deleteShader(r),Error(`The GPU body's shader did not compile: ${t}`)}return r}function Et(e,t,n,r){let i=e.createProgram();if(i===null)throw Error(`The GPU body could not make a program.`);let a=Tt(e,Re,t),o=Tt(e,ze,n);if(e.attachShader(i,a),e.attachShader(i,o),e.linkProgram(i),e.deleteShader(a),e.deleteShader(o),e.getProgramParameter(i,Ve)!==!0){let t=e.getProgramInfoLog(i);throw e.deleteProgram(i),Error(`The GPU body's program did not link: ${t}`)}let s={};for(let t of r){let n=e.getUniformLocation(i,t);s[t]=n===null?null:Z(n)}return{program:Z(i),uniforms:s}}function Q(e,t,n){let r=e.createBuffer();if(r===null)throw Error(`The GPU body could not make a buffer.`);return e.bindBuffer(t,r),e.bufferData(t,n,Ue),r}function Dt(e,t,n,r){let i=e.createVertexArray();if(i===null)throw Error(`The GPU body could not make a vertex array.`);e.bindVertexArray(i);for(let[r,i,a]of n){let n=e.getAttribLocation(t,r);n<0||(e.bindBuffer(K,i),e.enableVertexAttribArray(n),e.vertexAttribPointer(n,a,We,!1,0,0))}return e.bindBuffer(He,r),e.bindVertexArray(null),i}function Ot(e,t){let n=e.createTexture();if(n===null)throw Error(`The GPU body could not make a texture.`);return e.bindTexture(q,n),e.texParameteri(q,$e,nt),e.texParameteri(q,Qe,nt),e.texParameteri(q,et,t),e.texParameteri(q,tt,t),n}function kt(e,t,n={}){let r=n.haloTexels??512,i=ie(t),a=Le(i),o=Et(e,Ee,De,St),s=Et(e,Ce,we,Ct),c=Et(e,je,Me,wt),l=a.attributes.map(({name:t,size:n,values:r})=>[t,Q(e,K,r),n]);l.push([`corner`,Q(e,K,a.corner),2]);let u=Q(e,He,a.index),d=Dt(e,o.program,l,u),f=Dt(e,s.program,l,u),p=Q(e,K,bt),m=Q(e,He,xt),h=Dt(e,c.program,[[`corner`,p,2]],m),g=Ot(e,rt);e.texImage2D(q,0,Ze,64,64,0,Xe,Ge,xe(t));let _=Ot(e,it);e.texImage2D(q,0,Ze,r*2,r,0,Xe,Ge,null),e.bindTexture(q,null);let v=e.createFramebuffer();if(v===null)throw Error(`The GPU body could not make a framebuffer.`);e.bindFramebuffer(J,v),e.framebufferTexture2D(J,at,q,_,0);let y=e.checkFramebufferStatus(J)===ot;if(e.bindFramebuffer(J,null),!y)throw Error(`The GPU body could not render into its halo target.`);return{haloTexels:r,rowCount:i.count,indexCount:a.index.length,indexType:a.index instanceof Uint16Array?Ke:qe,fragmentUniforms:ge(),haloPlacement:{texelUnits:0,radiusFraction:0},shares:[0,0,0],haloUnion:o,strokes:s,haloLight:c,haloUnionArray:Z(d),strokeArray:Z(f),squareArray:Z(h),sparkle:Z(g),haloTexture:Z(_),haloFramebuffer:Z(v)}}function $(e,t,n){"worklet";t!=null&&(typeof n==`number`?e.uniform1f(t,n):n.length===2?e.uniform2f(t,n[0],n[1]):n.length===3?e.uniform3f(t,n[0],n[1],n[2]):n.length===4&&e.uniform4f(t,n[0],n[1],n[2],n[3]))}function At(e,t,n){"worklet";for(let r=0;r<X.length;r++){let i=X[r];$(e,t.uniforms[i],n[i].value)}}function jt(e,t,n){"worklet";let r=Oe(n,t.haloPlacement,t.haloTexels);e.bindFramebuffer(J,t.haloFramebuffer),e.viewport(0,0,t.haloTexels*2,t.haloTexels),e.clear(st),e.enable(ct),e.blendEquationSeparate(ht,ht),e.blendFuncSeparate(Y,Y,Y,Y);let i=t.haloUnion;e.useProgram(i.program),At(e,i,t.fragmentUniforms),$(e,i.uniforms.texelUnits,r.texelUnits),$(e,i.uniforms.radiusFraction,r.radiusFraction),e.bindVertexArray(t.haloUnionArray),e.drawElements(Je,t.indexCount,t.indexType,0)}function Mt(e,t,n){"worklet";let{camera:r}=n,i=t.strokes;e.useProgram(i.program),At(e,i,t.fragmentUniforms),e.uniformMatrix4fv(i.uniforms.modelViewMatrix,!1,r.modelView),e.uniformMatrix4fv(i.uniforms.projectionMatrix,!1,r.projection),$(e,i.uniforms.viewportHeight,Math.max(1,r.height)),$(e,i.uniforms.unitMetres,r.unitLength),$(e,i.uniforms.alphaFromLight,n.alphaFromLight),e.activeTexture(Ye),e.bindTexture(q,t.sparkle),e.uniform1i(i.uniforms.sparkle,0),e.bindVertexArray(t.strokeArray),e.drawElements(Je,t.indexCount,t.indexType,0)}function Nt(e,t,n){"worklet";let{camera:r,state:i}=n,a=t.haloLight;e.useProgram(a.program),e.uniformMatrix4fv(a.uniforms.modelViewMatrix,!1,r.modelView),e.uniformMatrix4fv(a.uniforms.projectionMatrix,!1,r.projection),$(e,a.uniforms.viewRight,t.fragmentUniforms.viewRight.value),$(e,a.uniforms.viewUp,t.fragmentUniforms.viewUp.value),$(e,a.uniforms.halfSide,.5/i.radius),$(e,a.uniforms.haloShares,Ae(i.glowGain,t.shares)),$(e,a.uniforms.alphaFromLight,n.alphaFromLight),e.activeTexture(Ye),e.bindTexture(q,t.haloTexture),e.uniform1i(a.uniforms.halo,0),e.bindVertexArray(t.squareArray),e.drawElements(Je,xt.length,Ke,0)}function Pt(e,t,n){"worklet";let{state:r,camera:i}=n;e.disable(ut),e.disable(lt),e.disable(dt),e.disable(ft),e.disable(pt),e.bindFramebuffer(J,null),e.clearColor(0,0,0,0),e.clear(st),n.fade>0&&r.arrival>0&&(ve(t.fragmentUniforms,r,i.basis,n.density,i.eyeDistance),jt(e,t,r.radius),e.bindFramebuffer(J,null),e.viewport(0,0,i.width,i.height),e.blendEquationSeparate(mt,mt),e.blendFuncSeparate(vt,gt,yt,_t),e.blendColor(n.fade,n.fade,n.fade,n.fade),Mt(e,t,n),Nt(e,t,n),e.bindVertexArray(null),e.bindTexture(q,null),e.disable(ct))}function Ft(e){"worklet";let t=Math.hypot(e[0],e[1],e[2]);return t<1e-6?null:[e[0]/t,e[1]/t,e[2]/t]}function It(e,t){"worklet";return[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]]}function Lt(e,t){"worklet";return e[0]*t[0]+e[1]*t[1]+e[2]*t[2]}function Rt(e,t){"worklet";return Ft([t.x-e.x,0,t.z-e.z])??[0,0,1]}function zt(e){"worklet";return{right:[e[2],0,-e[0]],up:[0,1,0],front:e}}function Bt(e,t,n){"worklet";let r=Ft([t.x-e.x,t.y-e.y,t.z-e.z]);if(r===null)return n??P;let i=Ft([-r[1]*r[0],1-r[1]*r[1],-r[1]*r[2]]);return i===null?n??P:{right:It(i,r),up:i,front:r}}function Vt(e,t){"worklet";let n=e=>[Lt(e,t.right),Lt(e,t.up),Lt(e,t.front)];return{right:n(e.right),up:n(e.up),front:n(e.front)}}var Ht={blending:5,blendEquation:100,blendSrc:211,blendDst:203,blendEquationAlpha:100,blendSrcAlpha:213,blendDstAlpha:205};function Ut(e,t){e.blendColor.setScalar(t),e.blendAlpha=t}var Wt=.85,Gt=`
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

in vec3 position;
in vec2 uv;

out vec2 pictureCoordinate;
out vec2 haloCoordinate;

void main() {
  // An ImageBitmap is uploaded top row first whatever UNPACK_FLIP_Y says, so the top of the
  // picture is at v = 0 while the top of the quad is at v = 1. The halo target was rendered by
  // three, bottom row first, so it is the right way up as it is.
  pictureCoordinate = vec2(uv.x, 1.0 - uv.y);
  haloCoordinate = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,Kt=`
precision highp float;

uniform sampler2D picture;
// How far CanvasKit has already faded the picture (the phone's arrival layer), undone here so
// the whole quad is faded once, by the blend (see layer-blending.ts).
uniform float pictureFade;
uniform float alphaFromLight;

in vec2 pictureCoordinate;
in vec2 haloCoordinate;

out vec4 colour;

${ke}

void main() {
  // Raw encoded sRGB, exactly as Skia wrote it: the projection layer is treated as sRGB and
  // premultiplied, so blending these values matches what the phone's Screen blend does.
  vec3 light = min(vec3(1.0), texture(picture, pictureCoordinate).rgb / pictureFade);
  vec3 glow = haloGlow(haloCoordinate);
  light = light + glow - light * glow;
  colour = vec4(light, alphaFromLight * max(light.r, max(light.g, light.b)));
}
`;function qt(e){let t=new C;t.flipY=!1,t.generateMipmaps=!1,t.minFilter=D,t.magFilter=D;let n=new O({glslVersion:E,vertexShader:Gt,fragmentShader:Kt,uniforms:{picture:{value:t},halo:{value:null},haloShares:{value:new w},pictureFade:{value:1},alphaFromLight:{value:Wt}},transparent:!0,depthWrite:!1,premultipliedAlpha:!0,...Ht});Ut(n,1);let r=new k(new T(e,e),n);r.visible=!1;let i=null,a=[0,0,0];return{mesh:r,showPicture(e){i?.close(),i=e,t.image=e,t.needsUpdate=!0,r.visible=!0},showHalo(e,t){let{uniforms:r}=n;r.halo.value=e,r.haloShares.value.fromArray(Ae(e===null?0:t,a))},setFade(e,t){Ut(n,e),n.uniforms.pictureFade.value=Math.max(t,.001)},dispose(){i?.close(),i=null,t.dispose(),n.dispose(),r.geometry.dispose()}}}export{ve as C,he as D,me as E,ie as O,ge as S,B as T,we as _,zt as a,Se as b,Bt as c,Fe as d,Le as f,Oe as g,Ee as h,Ut as i,kt as l,De as m,qt as n,Rt as o,W as p,Ht as r,Vt as s,Wt as t,Pt as u,U as v,V as w,ye as x,Ce as y};