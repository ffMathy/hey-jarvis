import{C as e,D as t,E as n,G as r,J as i,K as a,L as o,M as s,N as c,O as l,P as u,S as d,T as f,U as ee,W as p,_ as m,b as h,k as g,q as _,v,w as y,y as b}from"./room-session-DQVW18aK.js";import{D as x,F as S,L as C,O as w,P as T,R as E,S as D,f as O,h as k,j as A,k as j,o as M,p as N,r as P,s as F,u as I,v as L,w as R,z as te}from"./three-DIZGKSF5.js";var ne={right:[1,0,0],up:[0,1,0],front:[0,0,1]};function z(e){return e>0?e>1?1:e:0}function B(e){let t=e<0?0:e>1?1:e;return t*t*(3-2*t)}function V(e){return e-Math.floor(e)}function H(e,t){return e[0]*t[0]+e[1]*t[1]+e[2]*t[2]}function re(e,t,n,r){if(r.swirl>=1)return 1;let i=z(.9*Math.sqrt(e*e+t*t)+.1*V(n*3.91));return .04+.96*B((r.swirl-.6*i)/.4)}function U(e){return t*(1+y*e.hearingLevel*Math.sin(e.time*n))}var W=.816;function ie(e,t){return Number.isFinite(t)?t/Math.max(t-e,.1*t):1}function ae(e,t,n,r,i,a){let o=i.hearing*f;if(o<=.001)return[e,t,n];let s=ie(n,a),c=i.listened;p(e*s,t*s,r,i,c);let l=U(i)*W,u=Math.floor(n/l+.5)*l,d=1/ie(u,a);return[e+(c[0]*d-e)*o,t+(c[1]*d-t)*o,n+(u-n)*o]}function G(e,t,n,r){let i=e-m,a=t-v;return[m+i*n-a*r,v+i*r+a*n]}function K(e,t,n,r){let{right:i,up:a,front:o}=e;return[t*i[0]-n*a[0]+r*o[0],t*i[1]-n*a[1]+r*o[1],t*i[2]-n*a[2]+r*o[2]]}function oe(e,t,n){let{x:r,y:i,axisX:a,axisY:o}=e,s=-o*.55,c=a*.55,l=[r,i];if(e.group===1){let e=t.shellTurn*Math.PI/180,n=Math.cos(e),l=Math.sin(e);[r,i]=G(r,i,n,l),[a,o]=[a*n-o*l,a*l+o*n],[s,c]=[s*n-c*l,s*l+c*n]}return{centre:K(n,r,i,e.depth),axis:K(n,a,o,e.axisDepth),normal:K(n,s,c,0),tier:e.tier,glyph:e.glyph,group:e.group,plane:l}}function se(e,t,n,a,o=1/0){let s=n.reading,c=r(e,t,n,s);if(c<=0)return null;let[u=0,f=0,p=0,m=0]=[s[1],s[2],s[3],s[4]],h=e[t],g=e[t+1],v=e[t+2],y=e[t+3],b=e[t+4],x=e[t+6],S=e[t+9],C=V(p*.618034+x*9.7),w=(C-.5)*1.4*b,T=z((.76-(h*h+g*g))*3.2),E=(V(C*23.17)-.5)*(d+1.3*n.agitation*T),D=[h*n.bodyCos+S*n.bodySin,-g,S*n.bodyCos-h*n.bodySin],O=H(D,a.right),k=-H(D,a.up),A=H(D,a.front),j=k+y*w+v*E,M=O+v*w-y*E,N=c*z((.94*.94-O*O-j*j)*8);if(N<.1)return null;i(M,j,v,y,x,n);let[P=0,F=0,I=0,L=0,R=0]=n.swirled;if(R<=0)return null;let[te,ne,B]=ae(P,F,A*re(M,j,x,n),x,n,o),U=N*_(-K(a,te,ne,B)[1],n);if(U<.1)return null;let W=A>=0,ie=W?ee(m,U,x,n.hotShare):0,G=b*.5*U*R*(1-l*n.hearing);return oe({x:te,y:ne,depth:B,axisX:I*G,axisY:L*G,axisDepth:0,tier:n.scanBright[0]>0&&W?2:ie,glyph:u,group:+(f>0)},n,a)}function ce(e,t,n,r,o=1/0){let s=a(e,t,n);if(s<=0)return null;let c=n.reading[0],u=e[t],d=e[t+1],f=e[t+2],p=e[t+3],m=e[t+4],h=e[t+7],g=[u*n.streamCos+f*n.streamSin,-d,f*n.streamCos-u*n.streamSin],_=H(g,r.right),v=-H(g,r.up),y=H(g,r.front),b=s*z((.86-_*_-v*v)*8);if(b<.1)return null;let x=[p*n.streamCos+m*n.streamSin,0,m*n.streamCos-p*n.streamSin],S=y<0?0:ee(e[t+8]-3*c,b,h,n.hotShare);i(_,v,1,0,h,n);let[C=0,w=0,T=0,E=0,D=0]=n.swirled;if(D<=0)return null;let[O,k,A]=ae(C,w,y*re(_,v,h,n),h,n,o),j=H(x,r.right)<0?-1:1,M=j*H(x,r.right),N=-j*H(x,r.up),P=j*H(x,r.front),F=b*D*(1-l*n.hearing);return oe({x:O,y:k,depth:A,axisX:(M*T-N*E)*F,axisY:(M*E+N*T)*F,axisDepth:P*F,tier:S,glyph:e[t+9],group:0},n,r)}function q(e){let t=String(e);return/[.e]/.test(t)?t:`${t}.0`}function J(e){let t=t=>q((e>>t&255)/255);return`vec3(${t(16)}, ${t(8)}, ${t(0)})`}function le(){return{time:{value:0},bodyShare:{value:1},mixShare:{value:0},hotShare:{value:1},agitation:{value:0},swirl:{value:1},hearing:{value:0},thinking:{value:0},scanHeight:{value:0},density:{value:1},bodyTurn:{value:[1,0]},streamTurn:{value:[1,0]},shellTurn:{value:[1,0]},lattice:{value:[1,0,.11,0]},viewRight:{value:[1,0,0]},viewUp:{value:[0,1,0]},viewFront:{value:[0,0,1]},eyeDistance:{value:ue}}}var ue=1e5;function de(e,t,n,r,i){e.time.value=t.time,e.bodyShare.value=t.bodyShare,e.mixShare.value=t.mix,e.hotShare.value=t.hotShare,e.agitation.value=t.agitation,e.swirl.value=t.swirl,e.hearing.value=t.hearing,e.thinking.value=t.thinking,e.scanHeight.value=t.scan,e.density.value=r,e.bodyTurn.value=[t.bodyCos,t.bodySin],e.streamTurn.value=[t.streamCos,t.streamSin];let a=t.shellTurn*Math.PI/180;e.shellTurn.value=[Math.cos(a),Math.sin(a)];let o=t.time*g;e.lattice.value=[Math.cos(o),Math.sin(o),U(t),t.hearing*f],e.viewRight.value=n.right,e.viewUp.value=n.up,e.viewFront.value=n.front,e.eyeDistance.value=Number.isFinite(i)?i:ue}var Y=`
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

const float DUTY = ${q(b)};
const float FAINTEST = ${q(h)};
const float WANDER = ${q(d)};
const float SCAN_HALF_WIDTH = ${q(u)};
const float SCAN_FLOOR = ${q(c)};
const float SCAN_BRIGHT_NEARNESS = ${q(s)};
const float STROKE_SHRINK = ${q(l)};
const float VORTEX_TWIST = ${q(o)};
const float VORTEX_STRETCH = ${q(4)};
const float LAYER_SHARE = ${q(W)};
const vec2 CORE = vec2(${q(m)}, ${q(v)});

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
`,X=`
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
`,fe={blending:5,blendEquation:100,blendSrc:211,blendDst:203,blendEquationAlpha:100,blendSrcAlpha:213,blendDstAlpha:205};function Z(e,t){e.blendColor.setScalar(t),e.blendAlpha=t}function pe(e){return{rest:new O(e.rest,4),shape:new O(e.shape,4),hashes:new O(e.hashes,4),identity:new O(e.identity,4),thinning:new O(e.thinning,1),count:e.count}}function me(e){let t=new N;return t.setAttribute(`corner`,new P(new Float32Array([-1,-1,1,-1,1,1,-1,1]),2)),t.setIndex([0,1,2,0,2,3]),t.setAttribute(`rest`,e.rest),t.setAttribute(`shape`,e.shape),t.setAttribute(`hashes`,e.hashes),t.setAttribute(`identity`,e.identity),t.setAttribute(`thinning`,e.thinning),t.instanceCount=e.count,t}var he=1.152,ge=625341585;function _e(e){let t=new Uint8Array(16384);for(let n=0;n<4096;n++){let r=Math.imul(n^e,2654435761);r^=r>>>15,r=Math.imul(r,2246822519),r^=r>>>13;let i=(r>>>16&65535)/65536,a=(r&65535)/65536,o=i<.25?.5+i:i>.9?1:.72+.2*a,s=Math.round(255*o);t.set([s,s,s,255],n*4)}return t}function ve(e){let t=new F(_e(e^ge),64,64,x,S);return t.wrapS=j,t.wrapT=j,t.minFilter=k,t.magFilter=k,t.generateMipmaps=!1,t.colorSpace=``,t.needsUpdate=!0,t}var Q={colour:14441504,dim:{width:.115,strength:.3*e},mid:{width:.12,strength:.34*e},bright:{width:.115,strength:.38*e}},ye=`
precision highp float;
precision highp int;

// One texel, in the drawing's unit, and his radius as a share of the square the target covers.
uniform float texelUnits;
uniform float radiusFraction;

in vec2 corner;

${Y}
${X}

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
  haloRadius = 0.5 * (fragment.tier > 0.5 && fragment.tier < 1.5 ? ${q(Q.mid.width)} : ${q(Q.dim.width)}) * perspective;
  local = corner * (glyphReach(fragment.glyph, halfLength, normalLength) + haloRadius + 1.5 * texelUnits);
  glyphShape = vec4(fragment.glyph, halfLength, normalLength, fragment.tier);

  // Into the target: the pinned half on the left, the turning half on the right, y up as a
  // texture's rows go.
  vec2 point = centre + along * local.x + across * local.y;
  vec2 share = vec2(0.5 + point.x * radiusFraction, 0.5 - point.y * radiusFraction);
  gl_Position = vec4(share.x - 1.0 + fragment.group, 2.0 * share.y - 1.0, 0.0, 1.0);
}
`,be=`
precision highp float;
precision highp int;

in vec2 local;
flat in vec4 glyphShape;
flat in float haloRadius;

out vec4 colour;

${X}

void main() {
  float texel = max(length(fwidth(local)) * 0.70710678, 1e-6);
  float edgeDistance = glyphLineDistance(local, glyphShape.x, glyphShape.y, glyphShape.z) - haloRadius;
  float covered = clamp(0.5 - edgeDistance / texel, 0.0, 1.0);
  if (covered <= 0.0) discard;
  float tier = glyphShape.w;
  colour = vec4(tier < 0.5 ? covered : 0.0, tier > 0.5 && tier < 1.5 ? covered : 0.0, tier > 1.5 ? covered : 0.0, 0.0);
}
`;function xe(e,t){let n=new te(1024,512,{type:S,format:x,depthBuffer:!1,stencilBuffer:!1,generateMipmaps:!1,minFilter:k,magFilter:k});n.texture.colorSpace=``;let r={texelUnits:{value:.01},radiusFraction:{value:.27}},i=new w({glslVersion:I,vertexShader:ye,fragmentShader:be,uniforms:{...t,...r},side:2,depthTest:!1,depthWrite:!1,blending:5,blendEquation:104,blendEquationAlpha:104,blendSrc:201,blendDst:201,blendSrcAlpha:201,blendDstAlpha:201}),a=new L(me(e),i);a.frustumCulled=!1;let o=new A;o.add(a);let s=new D,c=new M;return{texture:n.texture,mesh:a,target:n,uniforms:r,render(e){let t=e.getRenderTarget(),r=e.xr.enabled,i=e.autoClear;e.getClearColor(c);let a=e.getClearAlpha();e.xr.enabled=!1,e.autoClear=!1,e.setRenderTarget(n),e.setClearColor(0,0),e.clear(!0,!1,!1),e.render(o,s),e.setClearColor(c,a),e.autoClear=i,e.xr.enabled=r,e.setRenderTarget(t)},dispose(){n.dispose(),i.dispose(),a.geometry.dispose()}}}var Se=.85,Ce=`
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
`,we=`
precision highp float;

uniform sampler2D picture;
uniform sampler2D halo;
// The halo tiers' strengths (dim, mid, bright) times the voice's glow; all 0 with no halo pass.
uniform vec3 haloShares;
// How far CanvasKit has already faded the picture (the phone's arrival layer), undone here so
// the whole quad is faded once, by the blend (see layer-blending.ts).
uniform float pictureFade;
uniform float alphaFromLight;

in vec2 pictureCoordinate;
in vec2 haloCoordinate;

out vec4 colour;

const vec3 HALO = ${J(Q.colour)};

// What is left of the light behind once one tier's halo is Screened over it.
vec3 through(float covered, float share) {
  return vec3(1.0) - HALO * (share * covered);
}

void main() {
  // Raw encoded sRGB, exactly as Skia wrote it: the projection layer is treated as sRGB and
  // premultiplied, so blending these values matches what the phone's Screen blend does.
  vec3 light = min(vec3(1.0), texture(picture, pictureCoordinate).rgb / pictureFade);
  // The halo union's two groups, each tier Screened over the rest as the phone's paths are.
  vec3 pinned = texture(halo, vec2(haloCoordinate.x * 0.5, haloCoordinate.y)).rgb;
  vec3 turning = texture(halo, vec2(0.5 + haloCoordinate.x * 0.5, haloCoordinate.y)).rgb;
  vec3 left = through(pinned.r, haloShares.x) * through(pinned.g, haloShares.y) * through(pinned.b, haloShares.z)
    * through(turning.r, haloShares.x) * through(turning.g, haloShares.y) * through(turning.b, haloShares.z);
  vec3 glow = vec3(1.0) - left;
  light = light + glow - light * glow;
  colour = vec4(light, alphaFromLight * max(light.r, max(light.g, light.b)));
}
`;function Te(e){let t=new T;t.flipY=!1,t.generateMipmaps=!1,t.minFilter=k,t.magFilter=k;let n=new w({glslVersion:I,vertexShader:Ce,fragmentShader:we,uniforms:{picture:{value:t},halo:{value:null},haloShares:{value:new C},pictureFade:{value:1},alphaFromLight:{value:Se}},transparent:!0,depthWrite:!1,premultipliedAlpha:!0,...fe});Z(n,1);let r=new L(new R(e,e),n);r.visible=!1;let i=null;return{mesh:r,showPicture(e){i?.close(),i=e,t.image=e,t.needsUpdate=!0,r.visible=!0},showHalo(e,t){let{uniforms:r}=n;r.halo.value=e;let i=e===null?0:t;r.haloShares.value.set(Q.dim.strength*i,Q.mid.strength*i,Q.bright.strength*i)},setFade(e,t){Z(n,e),n.uniforms.pictureFade.value=Math.max(t,.001)},dispose(){i?.close(),i=null,t.dispose(),n.dispose(),r.geometry.dispose()}}}var $={dim:{colour:13397548,width:.014,alpha:.62},mid:{colour:16281638,width:.0155,alpha:.85},bright:{colour:16743976,width:.0165,alpha:1},hot:{colour:16748092,width:.007,alpha:.8}},Ee=1.2,De=`
precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
// The height of the viewport being drawn, in pixels, and how many metres the drawing's unit is.
uniform float viewportHeight;
uniform float unitMetres;

in vec2 corner;

${Y}
${X}

// Where this corner is in the glyph's own frame — along it, across it — in the drawing's unit.
out vec2 local;
// Where it is in the view plane before the inner layer's turn, which is where the sparkle is read.
out vec2 sparklePoint;
// The glyph, its half-length, its normal's length and its tier.
flat out vec4 glyphShape;

const float WIDEST_HALF_STROKE = ${q($.bright.width/2)};
const float THINNEST_PIXELS = ${q(Ee)};

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
`,Oe=`
precision highp float;
precision highp int;

uniform sampler2D sparkle;
uniform float agitation;
// How much of the room behind his light hides; the fades are the blend's (see layer-blending.ts).
uniform float alphaFromLight;

in vec2 local;
in vec2 sparklePoint;
flat in vec4 glyphShape;

out vec4 colour;

${X}

const vec3 DIM = ${J($.dim.colour)};
const vec3 MID = ${J($.mid.colour)};
const vec3 BRIGHT = ${J($.bright.colour)};
const vec3 HOT = ${J($.hot.colour)};
const float THINNEST_PIXELS = ${q(Ee)};
const float SPARKLE_REPEAT = ${q(he)};

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
  float halfWidth = ${q($.dim.width/2)};
  float strength = ${q($.dim.alpha)};
  if (tier > 1.5) {
    paint = BRIGHT * sparkleLevel;
    halfWidth = ${q($.bright.width/2)};
    strength = 1.0 - 0.25 * agitation;
  } else if (tier > 0.5) {
    paint = MID * sparkleLevel;
    halfWidth = ${q($.mid.width/2)};
    strength = ${q($.mid.alpha)};
  }
  float drawnHalf = max(halfWidth, 0.5 * THINNEST_PIXELS * pixel);
  strength *= halfWidth / drawnHalf;
  vec3 light = paint * strength * coverage(glyphStrokeDistance(local, glyph, halfLength, normalLength, drawnHalf), pixel);

  if (tier > 1.5) {
    float hotHalf = ${q($.hot.width/2)};
    float drawnHot = max(hotHalf, 0.5 * THINNEST_PIXELS * pixel);
    float hotStrength = ${q($.hot.alpha)} * (1.0 - 0.95 * agitation) * hotHalf / drawnHot;
    float hotDistance = glyphLineDistance(local, glyph, halfLength, normalLength) - drawnHot;
    vec3 hot = HOT * sparkleLevel * hotStrength * coverage(hotDistance, pixel);
    // Screen, as the phone lays the hot core over the bright stroke.
    light = light + hot - light * hot;
  }
  float brightest = max(light.r, max(light.g, light.b));
  if (brightest <= 0.0) discard;
  colour = vec4(light, alphaFromLight * brightest);
}
`;function ke(e,t,n){let r={viewportHeight:{value:1},unitMetres:{value:1},sparkle:{value:n},alphaFromLight:{value:Se}},i=new w({glslVersion:I,vertexShader:De,fragmentShader:Oe,uniforms:{...t,...r},side:2,transparent:!0,depthWrite:!1,premultipliedAlpha:!0,...fe});Z(i,1);let a=new L(me(e),i);a.frustumCulled=!1;let o=new E;return a.onBeforeRender=e=>{r.viewportHeight.value=Math.max(1,e.getCurrentViewport(o).w)},{mesh:a,uniforms:r,dispose(){i.dispose(),a.geometry.dispose()}}}export{se as _,Te as a,ve as c,Y as d,le as f,ne as g,de as h,Se as i,pe as l,q as m,Ee as n,Q as o,J as p,ke as r,xe as s,$ as t,Z as u,ce as v};