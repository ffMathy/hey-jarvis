import{A as e,C as t,D as n,E as r,F as i,G as a,H as o,I as s,J as c,K as l,L as u,M as d,N as f,O as p,P as m,Q as h,S as g,T as _,U as v,V as y,X as b,Y as x,Z as ee,_ as S,ct as C,dt as te,ft as w,ht as ne,it as T,j as E,k as D,lt as re,mt as ie,nt as O,ot as ae,pt as oe,q as se,rt as ce,st as le,ut as ue,v as k,w as de,x as fe,y as pe,z as A}from"./room-session-CchnwNi_.js";import{L as j,T as me,d as he,k as ge,y as _e}from"./three-BdQlZwYR.js";var ve=.6,ye=.9,be=.35,xe=.4,Se=.35,Ce=18*Math.PI/180,we=`M 0.45 0 A 0.45 0.45 0 1 0 -0.45 0 A 0.45 0.45 0 1 0 0.45 0 Z`,Te={satellites:new Map,steppedAt:void 0,arrivals:0};function M(e){return e===`answered`||e===`failed`}function Ee(e,t){switch(t.state){case`planned`:return e===void 0||M(e)?`planned`:e;case`tool`:case`working`:return`working`;default:return t.state}}function De(e,t,n){let r=e.satellites.get(t.delegationId);if(r===void 0||M(r.status)&&t.state===`planned`)return Oe(e,t,n);if(M(r.status))return e;let i=Ee(r.status,t),a=new Map(e.satellites);return a.set(t.delegationId,{...r,status:i,glyph:t.glyph??r.glyph,heardAt:n,toolAt:t.state===`tool`?n:r.toolAt,endedAt:M(i)?n:void 0}),{...e,satellites:a}}function Oe(e,t,n){let r=Ee(void 0,t);if(M(r)||Ae(e)>=8)return e;let i=new Map(e.satellites);return i.set(t.delegationId,{agentId:t.agentId,glyph:t.glyph,status:r,heardAt:n,toolAt:t.state===`tool`?n:void 0,endedAt:void 0,presence:0,offset:je(e,e.arrivals),order:e.arrivals}),{...e,satellites:i,arrivals:e.arrivals+1}}function ke(e,t){if(e.satellites.size===0)return e;let n=new Map;for(let[r,i]of e.satellites)n.set(r,M(i.status)?i:{...i,status:`answered`,endedAt:t});return{...e,satellites:n}}function Ae(e){let t=0;for(let n of e.satellites.values())M(n.status)||t++;return t}function je(e,t){let n=[...e.satellites.values()].filter(e=>!M(e.status)).map(e=>Me(e.offset)).sort((e,t)=>e-t);if(n.length===0)return t===0?0:Me(t*.38);let r={start:n[n.length-1]??0,size:1-(n[n.length-1]??0)+(n[0]??0)};for(let e=1;e<n.length;e++){let t=n[e-1]??0,i=(n[e]??0)-t;i>r.size&&(r={start:t,size:i})}return Me(r.start+r.size/2)}function Me(e){return e-Math.floor(e)}function Ne(e,t){return Me(t-e+.5)-.5}function Pe(e,t){let n=e.steppedAt===void 0?0:Math.max(0,t-e.steppedAt),r=[...e.satellites.entries()].filter(([,e])=>!M(e.status)).sort(([,e],[,t])=>e.order-t.order),i=r[0]?.[1].offset??0,a=new Map(r.map(([e],t)=>[e,Me(i+t/r.length)])),o=new Map;for(let[r,i]of e.satellites){let e=!M(i.status)&&i.status!==`asking`&&t-i.heardAt>90?{...i,status:`failed`,endedAt:t}:i;if(e.endedAt!==void 0&&t-e.endedAt>=.9)continue;let s=a.get(r),c=1-Math.exp(-3*n);o.set(r,{...e,presence:Math.min(1,e.presence+n/be),offset:s===void 0?e.offset:Me(e.offset+Ne(e.offset,s)*c)})}return{...e,satellites:o,steppedAt:t}}function Fe(e){let t=Math.min(1,Math.max(0,e));return t*t*(3-2*t)}function Ie(e,t){return[...e.satellites.values()].sort((e,t)=>e.order-t.order).map(e=>{let n=e.endedAt===void 0?0:Fe((t-e.endedAt)/ye),r=e.status===`failed`,i=e.status===`planned`?xe:1,a=e.toolAt===void 0?0:Math.max(0,1-(t-e.toolAt)/ve);return{glyph:e.glyph??`M 0.45 0 A 0.45 0.45 0 1 0 -0.45 0 A 0.45 0.45 0 1 0 0.45 0 Z`,level:Fe(e.presence)*i*(1-n*(r?1:.6)),flare:a*a,asking:e.status===`asking`,turn:e.offset,reach:r?1+Se*n:1-n}})}function Le(e,t){"worklet";let n=2*Math.PI*(t/9+e.turn),r=Math.sin(n)*e.reach;return{across:Math.cos(n)*e.reach,up:-r*Math.sin(Ce),towards:r*Math.cos(Ce)}}function Re(e){return[...e.satellites.values()].sort((e,t)=>e.order-t.order).map(({agentId:e,status:t})=>({agentId:e,status:t}))}var ze=[{agentId:`sampleDiamond`,glyph:`M 0 -0.7 L 0.7 0 L 0 0.7 L -0.7 0 Z`},{agentId:`sampleSquare`,glyph:`M -0.55 -0.55 L 0.55 -0.55 L 0.55 0.55 L -0.55 0.55 Z`},{agentId:`sampleCross`,glyph:`M -0.65 0 L 0.65 0 M 0 -0.65 L 0 0.65`}],Be=1.4,Ve=e=>`sample-${e}`;function He(e,t,n){let r=e,i=Math.floor(n/Be);return ze.forEach(({agentId:e,glyph:a},o)=>{let s=Ve(e),c=r.satellites.get(s),l=c!==void 0&&!M(c.status);if(!t){l&&(r=De(r,{delegationId:s,agentId:e,glyph:a,state:`answered`},n));return}l||(r=De(r,{delegationId:s,agentId:e,glyph:a,state:`working`},n));let u=r.satellites.get(s)?.toolAt,d=u!==void 0&&Math.floor(u/1.4)===i;i%ze.length===o&&!d&&(r=De(r,{delegationId:s,agentId:e,glyph:a,state:`tool`},n))}),r}var Ue=.7,We=Ue,Ge=.45,Ke=1/128,qe=1337,Je=1.22,Ye=.13,Xe=1.6,Ze=.15,Qe=.8,$e=.45;function et(e,t){"worklet";if(e.level<=0)return;let{across:n,up:r,towards:i}=Le(e,t),a=.5+.5*Math.max(-1,Math.min(1,i)),o=.5+.5*Math.cos(2*Math.PI*t/Xe);return{across:n*Je,up:r*Je,glyphRadii:Ye*(Qe+.19999999999999996*a),light:e.level*($e+.55*a)*(e.asking?.55+.45*o:1)}}function tt(e){return e-Math.floor(e)}var nt=13.7,rt=3.91,it=7.7113,at=9.7;function ot(e){let t=e.body.length/9,n=e.stream.length/10,r=t+n,i={count:r,bodyCount:t,streamCount:n,rest:new Float32Array(r*4),shape:new Float32Array(r*4),hashes:new Float32Array(r*4),identity:new Float32Array(r*3),thinning:new Float32Array(r)};for(let n=0;n<t;n++)st(i,n,e.body,n*9);for(let r=0;r<n;r++)ct(i,t+r,e.stream,r*10);return i}function st(e,t,n,r){let{rest:i,shape:a,hashes:o,identity:s}=e,c=n[r+6],l=t*4;i[l]=n[r],i[l+1]=n[r+1],i[l+2]=n[r+8],i[l+3]=0,a[l]=n[r+2],a[l+1]=n[r+3],a[l+2]=n[r+4],a[l+3]=n[r+5],o[l]=tt(c*D),lt(o,l,c),s[t*3]=tt(c*at),s[t*3+1]=c,s[t*3+2]=n[r+7],e.thinning[t]=O(c)}function ct(e,t,n,r){let{rest:i,shape:a,hashes:o,identity:s}=e,c=n[r+7],l=t*4;i[l]=n[r],i[l+1]=n[r+1],i[l+2]=n[r+2],i[l+3]=1,a[l]=n[r+3],a[l+1]=n[r+4],a[l+2]=0,a[l+3]=n[r+5],o[l]=n[r+6],lt(o,l,c),s[t*3]=0,s[t*3+1]=c,s[t*3+2]=n[r+8]+24*n[r+9],e.thinning[t]=O(c)}function lt(e,t,n){e[t+1]=tt(n*nt),e[t+2]=tt(n*rt),e[t+3]=tt(n*it)}var ut={right:[1,0,0],up:[0,1,0],front:[0,0,1]};function dt(e){return e>0?e>1?1:e:0}function ft(e){let t=e<0?0:e>1?1:e;return t*t*(3-2*t)}function pt(e){return e-Math.floor(e)}function N(e,t){return e[0]*t[0]+e[1]*t[1]+e[2]*t[2]}function mt(e,t,n,r){if(r.swirl>=1)return 1;let i=dt(.9*Math.sqrt(e*e+t*t)+.1*pt(n*3.91));return .04+.96*ft((r.swirl-.6*i)/.4)}function ht(e){"worklet";return i*(1+d*e.hearingLevel*Math.sin(e.time*m))}var gt=.816;function _t(e,t){return Number.isFinite(t)?t/Math.max(t-e,.1*t):1}function vt(e,t,n,r,i,a){let o=i.hearing*f;if(o<=.001)return[e,t,n];let s=_t(n,a),c=i.listened;T(e*s,t*s,r,i,c);let l=ht(i)*gt,u=Math.floor(n/l+.5)*l,d=1/_t(u,a);return[e+(c[0]*d-e)*o,t+(c[1]*d-t)*o,n+(u-n)*o]}function yt(e,t,n,r,i,a){let o=e-n,s=t-r;return[n+o*i-s*a,r+o*a+s*i]}function bt(e,t,n,r){let{right:i,up:a,front:o}=e;return[t*i[0]-n*a[0]+r*o[0],t*i[1]-n*a[1]+r*o[1],t*i[2]-n*a[2]+r*o[2]]}function xt(e,t,n){let{x:r,y:i,axisX:a,axisY:o}=e,s=-o*.55,c=a*.55,l=[r,i];if(e.group>0){let n=ne(e.group,e.fromCore,t)*Math.PI/180,l=Math.cos(n),u=Math.sin(n),d=e.group!==3;[r,i]=yt(r,i,d?de:0,d?_:0,l,u),[a,o]=[a*l-o*u,a*u+o*l],[s,c]=[s*l-c*u,s*u+c*l]}return{centre:bt(n,r,i,e.depth),axis:bt(n,a,o,e.axisDepth),normal:bt(n,s,c,0),tier:e.tier,light:e.light,glyph:e.glyph,group:e.group,plane:l}}function St(e,t,n,r,i,a){if(r>0)return[e,t,n];let o=[e*i.bodyCos+n*i.bodySin,-t,n*i.bodyCos-e*i.bodySin];return[N(o,a.right),-N(o,a.up),N(o,a.front)]}function Ct(t,n,r,i,a=1/0){let o=r.reading,c=ae(t,n,r,o);if(c<=0)return null;let[l=0,u=0,d=0,f=0]=[o[1],o[2],o[3],o[4]],p=t[n],m=t[n+1],h=t[n+4],g=t[n+6],v=t[n+8],y=pt(d*.618034+g*9.7),[b,x,S]=St(p,m,v,u,r,i),te=[0,0];C(b,x,t[n+2],t[n+3],te,0);let w=ie(y,u,r),[ne=0,T=0]=te,E=ne*Math.cos(w)-T*Math.sin(w),D=ne*Math.sin(w)+T*Math.cos(w),O=u===2?0:dt((.76-(b*b+x*x))*3.2),se=pt(y*23.17)-.5,le=(y-.5)*1.4*h+se*1.3*r.agitation*O,k=u===3,fe=k?0:se*e,A=x+D*le+E*fe,j=b+E*le-D*fe,me=k?1:dt((.94*.94-j*j-A*A)*8),he=ue(j,A,p*p+m*m+v*v),ge=k?he*(1-ee*r.thinking):he,_e=c*me;if(_e<.1)return null;oe(j,A,E,D,g,r);let[ve=0,ye=0,be=0,xe=0,Se=0]=r.swirled;if(Se<=0)return null;let Ce=S*mt(j,A,g,r),[we,Te,M]=k?[ve,ye,Ce]:vt(ve,ye,Ce,g,r,a),Ee=k?_e:_e*re(-bt(i,we,Te,M)[1],r);if(Ee<.1)return null;let De=S>=-pe,Oe=!k&&r.scanBright[0]>0&&De,ke=De?ce(f,Ee*ge,g,r.hotShare):0,Ae=h*.5*Ee*Se*(1-s*r.hearing);return xt({x:we,y:Te,depth:M,axisX:be*Ae,axisY:xe*Ae,axisDepth:0,tier:Oe?2:ke,light:Oe?1:ge,glyph:l,group:u,fromCore:Math.hypot(p-de,m-_)},r,i)}function wt(e,t,n,r,i=1/0){let a=le(e,t,n);if(a<=0)return null;let o=n.reading[0],c=e[t],l=e[t+1],u=e[t+2],d=e[t+3],f=e[t+4],p=e[t+7],m=[c*n.streamCos+u*n.streamSin,-l,u*n.streamCos-c*n.streamSin],h=N(m,r.right),g=-N(m,r.up),_=N(m,r.front),v=a*dt((.86-h*h-g*g)*8);if(v<.1)return null;let y=[d*n.streamCos+f*n.streamSin,0,f*n.streamCos-d*n.streamSin],b=_<-.2?0:ce(e[t+8]-3*o,v,p,n.hotShare);oe(h,g,1,0,p,n);let[x=0,ee=0,S=0,C=0,te=0]=n.swirled;if(te<=0)return null;let[w,ne,T]=vt(x,ee,_*mt(h,g,p,n),p,n,i),E=N(y,r.right)<0?-1:1,D=E*N(y,r.right),re=-E*N(y,r.up),ie=E*N(y,r.front),O=v*te*(1-s*n.hearing);return xt({x:w,y:ne,depth:T,axisX:(D*S-re*C)*O,axisY:(D*C+re*S)*O,axisDepth:ie*O,tier:b,light:1,glyph:e[t+9],group:0,fromCore:0},n,r)}function P(e){let t=String(e);return/[.e]/.test(t)?t:`${t}.0`}function Tt(e){let t=t=>P((e>>t&255)/255);return`vec3(${t(16)}, ${t(8)}, ${t(0)})`}function Et(){return{time:{value:0},mixShare:{value:0},hotShare:{value:1},agitation:{value:0},swirl:{value:1},hearing:{value:0},thinking:{value:0},scanHeight:{value:0},density:{value:1},bodyTurn:{value:[1,0]},streamTurn:{value:[1,0]},shellTurn:{value:[1,0]},gyroSway:{value:[1,0]},rimTurn:{value:[1,0]},lattice:{value:[1,0,.11,0]},viewRight:{value:[1,0,0]},viewUp:{value:[0,1,0]},viewFront:{value:[0,0,1]},eyeDistance:{value:Dt}}}var Dt=1e5;function Ot(e,t,n,r,i){"worklet";e.time.value=t.time,e.mixShare.value=t.mix,e.hotShare.value=t.hotShare,e.agitation.value=t.agitation,e.swirl.value=t.swirl,e.hearing.value=t.hearing,e.thinking.value=t.thinking,e.scanHeight.value=t.scan,e.density.value=r,e.bodyTurn.value=[t.bodyCos,t.bodySin],e.streamTurn.value=[t.streamCos,t.streamSin];let a=t.shellTurn*Math.PI/180;e.shellTurn.value=[Math.cos(a),Math.sin(a)];let o=t.gyroSway*Math.PI/180;e.gyroSway.value=[Math.cos(o),Math.sin(o)];let s=t.rimRoll*Math.PI/180;e.rimTurn.value=[Math.cos(s),Math.sin(s)];let c=t.time*u;e.lattice.value=[Math.cos(c),Math.sin(c),ht(t),t.hearing*f],e.viewRight.value=n.right,e.viewUp.value=n.up,e.viewFront.value=n.front,e.eyeDistance.value=Number.isFinite(i)?i:Dt}var kt=`
uniform float time;
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
// The groups' turns in the view plane, as cosine and sine: the inner layer's, the gyroscope's
// rocking on top of it, and the truss's roll (turnOfGroup).
uniform vec2 shellTurn;
uniform vec2 gyroSway;
uniform vec2 rimTurn;
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
in vec3 identity;
in float thinning;

const float DUTY = ${P(n)};
const float FAINTEST = ${P(p)};
const float WANDER = ${P(e)};
const float SCAN_HALF_WIDTH = ${P(v)};
const float SCAN_FLOOR = ${P(o)};
const float SCAN_BRIGHT_NEARNESS = ${P(y)};
const float SHELL_FACE_DIMMING = ${P(a)};
const float BACK_OF_THE_SHELL = ${P(pe)};
const float STROKE_SHRINK = ${P(s)};
const float VORTEX_TWIST = ${P(h)};
const float VORTEX_STRETCH = ${P(4)};
const float LAYER_SHARE = ${P(gt)};
const vec2 CORE = vec2(${P(de)}, ${P(_)});
const int GLYPH_STEP = 24;
const int GROUP_STEP = 6;
const int INNER_LAYER_GROUP = 1;
const int GYRO_GROUP = 2;
const int TRUSS_GROUP = 3;
const float GIMBAL_SPLIT = ${P(E)};
const float THOUGHT_SCATTER = ${P(b)};
const float THOUGHT_FROM_HOP = ${P(x)};
const float TRUSS_THINKING_DIM = ${P(ee)};

struct Fragment {
  bool visible;
  // Its middle, half its length along it and the glyph's normal, in the body's frame.
  vec3 centre;
  vec3 axis;
  vec3 normal;
  float tier;
  // How much of its tier's paint it shows: less seen face on through the shell.
  float light;
  float glyph;
  float group;
  // Where it is in the view plane, and its half-length there, before its group's turn.
  vec2 plane;
  vec2 planeAxis;
};

Fragment hiddenFragment() {
  return Fragment(false, vec3(0.0), vec3(0.0), vec3(0.0), 0.0, 0.0, 0.0, 0.0, vec2(0.0), vec2(0.0));
}

float clamp01(float value) {
  return clamp(value, 0.0, 1.0);
}

// What is left of a speck's light seen through his shell where it is seen: shellFacing.
float shellFacing(vec2 seen, float radiusSquared) {
  if (radiusSquared <= 0.0) return 1.0;
  return 1.0 - SHELL_FACE_DIMMING * clamp01(1.0 - dot(seen, seen) / radiusSquared);
}

// Which way a speck lies in the view plane, where it is seen: its row's direction, along the ring
// through there and out from his middle, turned into the view's x and y. ringDirection.
vec2 ringDirection(vec2 seen, vec2 unit) {
  float reach = length(seen);
  if (reach <= 0.0) return unit;
  vec2 outward = seen / reach;
  return vec2(-outward.y * unit.x + outward.x * unit.y, outward.x * unit.x + outward.y * unit.y);
}

float smooth01(float value) {
  float clamped = clamp(value, 0.0, 1.0);
  return clamped * clamped * (3.0 - 2.0 * clamped);
}

// JavaScript's Math.round: halves go up.
float roundHalfUp(float value) {
  return floor(value + 0.5);
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

// A vector of the view plane turned by turn (cosine, sine): clockwise on screen, y down.
vec2 turnVector(vec2 vector, vec2 turn) {
  return vec2(vector.x * turn.x - vector.y * turn.y, vector.x * turn.y + vector.y * turn.x);
}

// A group's turn in the view plane (turnOfGroup): the inner layer's; the gyroscope's arcs rocked on
// top of it, those inside GIMBAL_SPLIT of the core one way and the rest the other; the truss's roll.
vec2 turnOfGroup(int group, float fromCore) {
  if (group == INNER_LAYER_GROUP) return shellTurn;
  if (group == GYRO_GROUP) return turnVector(shellTurn, fromCore < GIMBAL_SPLIT ? gyroSway : vec2(gyroSway.x, -gyroSway.y));
  return rimTurn;
}

vec3 intoBody(vec2 point, float depth) {
  return point.x * viewRight - point.y * viewUp + depth * viewFront;
}

// The last step every fragment shares: its group's turn in the view plane — about his middle for
// the truss, about the core for the rest — then out of the plane into the body's frame.
Fragment finishFragment(vec3 placed, vec2 axis, float axisDepth, float tier, float light, float glyph, int group, float fromCore) {
  Fragment fragment = hiddenFragment();
  fragment.visible = true;
  fragment.plane = placed.xy;
  fragment.planeAxis = axis;
  vec2 point = placed.xy;
  vec2 normal = vec2(-axis.y, axis.x) * 0.55;
  if (group > 0) {
    vec2 turn = turnOfGroup(group, fromCore);
    vec2 pivot = group == TRUSS_GROUP ? vec2(0.0) : CORE;
    point = pivot + turnVector(point - pivot, turn);
    axis = turnVector(axis, turn);
    normal = turnVector(normal, turn);
  }
  fragment.centre = intoBody(point, placed.z);
  fragment.axis = intoBody(axis, axisDepth);
  fragment.normal = intoBody(normal, 0.0);
  fragment.tier = tier;
  fragment.light = light;
  fragment.glyph = glyph;
  fragment.group = float(group);
  return fragment;
}

Fragment readBodyFragment() {
  float id = identity.y;
  float cycles = time * shape.w + hashes.x;
  float cycle = floor(cycles);
  float life = cycles - cycle;
  if (life >= DUTY) return hiddenFragment();
  // brightness + 3 × pool + GROUP_STEP × group + GLYPH_STEP × glyph, taken apart exactly in integers.
  int code = int(identity.z + 0.5);
  int glyph = code / GLYPH_STEP;
  int kind = code - GLYPH_STEP * glyph;
  int group = kind / GROUP_STEP;
  int pool = (kind - GROUP_STEP * group) / 3;
  float brightness = float(kind - GROUP_STEP * group - 3 * pool);
  float strength = fragmentStrength(life, id, float(pool));
  if (strength < FAINTEST) return hiddenFragment();

  float fragmentLength = shape.z;
  float hop = fract(cycle * 0.618034 + identity.x);
  vec3 turned = vec3(rest.x * bodyTurn.x + rest.z * bodyTurn.y, -rest.y, rest.z * bodyTurn.x - rest.x * bodyTurn.y);
  // The groups held in the view plane rest there: placeFragment.
  bool held = group > 0;
  float planeX = held ? rest.x : dot(turned, viewRight);
  float planeY = held ? rest.y : -dot(turned, viewUp);
  float depth = held ? rest.z : dot(turned, viewFront);
  vec2 unit = ringDirection(vec2(planeX, planeY), shape.xy);
  // While he thinks it lies some way dealt afresh at each blink: thoughtTurn.
  float scatter = group == TRUSS_GROUP ? 0.0 : thinking * (fract(hop * THOUGHT_FROM_HOP) - 0.5) * THOUGHT_SCATTER;
  unit = turnVector(unit, vec2(cos(scatter), sin(scatter)));
  // The voice's churn, which the gyroscope's arcs leave to their rocking.
  float inward = group == GYRO_GROUP ? 0.0 : clamp01((0.76 - (planeX * planeX + planeY * planeY)) * 3.2);
  float wander = fract(hop * 23.17) - 0.5;
  float along = (hop - 0.5) * 1.4 * fragmentLength + wander * 1.3 * agitation * inward;
  // The truss's specks slide only along their rails and rungs, and lie past the limb on purpose.
  bool truss = group == TRUSS_GROUP;
  float across = truss ? 0.0 : wander * WANDER;
  float y = planeY + unit.y * along + unit.x * across;
  float x = planeX + unit.x * along - unit.y * across;
  float edge = truss ? 1.0 : clamp01((0.94 * 0.94 - x * x - y * y) * 8.0);
  float light = shellFacing(vec2(x, y), dot(rest.xyz, rest.xyz));
  // The truss is not put out by the thinking plane; it recedes instead.
  if (truss) light *= 1.0 - TRUSS_THINKING_DIM * thinking;
  float lit = strength * edge;
  if (lit < FAINTEST) return hiddenFragment();

  float drawn;
  float scale;
  vec4 swirled = swirlFragment(vec2(x, y), unit, hashes.z, drawn, scale);
  if (drawn <= 0.0) return hiddenFragment();
  // The truss keeps its squares while he listens, and while he thinks.
  vec3 placed = vec3(swirled.xy, depth * scale);
  bool scanBright = false;
  float litHere = lit;
  if (!truss) {
    placed = onLattice(swirled.xy, depth * scale, hashes.w);
    litHere = lit * scanned(-intoBody(placed.xy, placed.z).y, scanBright);
  }
  if (litHere < FAINTEST) return hiddenFragment();
  bool facing = depth >= -BACK_OF_THE_SHELL;
  bool promoted = scanBright && facing;
  float plain = facing ? fragmentTier(brightness, litHere * light, hashes.y) : 0.0;
  float tier = promoted ? 2.0 : plain;
  float halfLength = fragmentLength * 0.5 * litHere * drawn * (1.0 - STROKE_SHRINK * hearing);
  return finishFragment(
    placed,
    swirled.zw * halfLength,
    0.0,
    tier,
    promoted ? 1.0 : light,
    float(glyph),
    group,
    length(rest.xy - CORE)
  );
}

Fragment readStreamFragment() {
  float id = identity.y;
  float cycles = time * shape.w + hashes.x;
  float life = cycles - floor(cycles);
  if (life >= DUTY) return hiddenFragment();
  int code = int(identity.z + 0.5);
  int glyph = code / GLYPH_STEP;
  int kind = code - GLYPH_STEP * glyph;
  int pool = kind >= 3 ? 1 : 0;
  float brightness = float(kind - 3 * pool);
  float strength = fragmentStrength(life, id, float(pool));
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
  float tier = depth < -BACK_OF_THE_SHELL ? 0.0 : fragmentTier(brightness, lit, hashes.y);

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
  return finishFragment(placed, axis, tangentDepth * size, tier, 1.0, float(glyph), 0, 0.0);
}

Fragment readFragment() {
  // A share keeps the rows whose key is under it. The index is in key order, so the phone's and the
  // watch's renderer draw only those (quadsKept); this hides the rest for a draw of every row.
  if (thinning >= density) return hiddenFragment();
  // An if rather than ?:, which WebGL does not allow on structures.
  if (rest.w < 0.5) return readBodyFragment();
  return readStreamFragment();
}
`,At=`
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
// segment has no length, as a butt cap does.
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
`,jt=64*se;function Mt(e){return te(e.textureSeed^l)}var F={dim:{colour:12342822,width:.014,alpha:.6},mid:{colour:15492644,width:.0155,alpha:.88},bright:{colour:16748096,width:.0155,alpha:1},hot:{colour:16758924,width:.007,alpha:.9}},Nt=1.2,Pt=`
precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
// The height of the viewport being drawn, in pixels, and how many metres the drawing's unit is.
uniform float viewportHeight;
uniform float unitMetres;

in vec2 corner;

${kt}
${At}

// Where this corner is in the glyph's own frame — along it, across it — in the drawing's unit.
out vec2 local;
// Where it is in the view plane before the inner layer's turn, which is where the sparkle is read.
out vec2 sparklePoint;
// The glyph, its half-length, its normal's length and its tier.
flat out vec4 glyphShape;
// How much of its tier's paint it shows.
flat out float shellLight;

const float WIDEST_HALF_STROKE = ${P(F.bright.width/2)};
const float THINNEST_PIXELS = ${P(Nt)};

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
  shellLight = fragment.light;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(fragment.centre + along * local.x + across * local.y, 1.0);
}
`,Ft=`
precision highp float;
precision highp int;

uniform sampler2D sparkle;
uniform float agitation;
// How much of what is behind his light it hides; the fades are the blend's.
uniform float alphaFromLight;

in vec2 local;
in vec2 sparklePoint;
flat in vec4 glyphShape;
flat in float shellLight;

out vec4 colour;

${At}

const vec3 DIM = ${Tt(F.dim.colour)};
const vec3 MID = ${Tt(F.mid.colour)};
const vec3 BRIGHT = ${Tt(F.bright.colour)};
const vec3 HOT = ${Tt(F.hot.colour)};
const float THINNEST_PIXELS = ${P(Nt)};
const float SPARKLE_REPEAT = ${P(jt)};

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
  float halfWidth = ${P(F.dim.width/2)};
  float strength = ${P(F.dim.alpha)};
  if (tier > 1.5) {
    paint = BRIGHT * sparkleLevel;
    halfWidth = ${P(F.bright.width/2)};
    strength = 1.0 - 0.25 * agitation;
  } else if (tier > 0.5) {
    paint = MID * sparkleLevel;
    halfWidth = ${P(F.mid.width/2)};
    strength = ${P(F.mid.alpha)};
  }
  float drawnHalf = max(halfWidth, 0.5 * THINNEST_PIXELS * pixel);
  strength *= halfWidth / drawnHalf;
  vec3 light = paint * strength * coverage(glyphStrokeDistance(local, glyph, halfLength, normalLength, drawnHalf), pixel);

  if (tier > 1.5) {
    float hotHalf = ${P(F.hot.width/2)};
    float drawnHot = max(hotHalf, 0.5 * THINNEST_PIXELS * pixel);
    float hotStrength = ${P(F.hot.alpha)} * (1.0 - 0.95 * agitation) * hotHalf / drawnHot;
    float hotDistance = glyphLineDistance(local, glyph, halfLength, normalLength) - drawnHot;
    vec3 hot = HOT * sparkleLevel * hotStrength * coverage(hotDistance, pixel);
    // Screen, as the phone lays the hot core over the bright stroke.
    light = light + hot - light * hot;
  }
  light *= shellLight;
  float brightest = max(light.r, max(light.g, light.b));
  if (brightest <= 0.0) discard;
  colour = vec4(light, alphaFromLight * brightest);
}
`,It=35633,Lt=35632,I=34962,Rt=34963,zt=35044,Bt=5126,Vt=5121,Ht=5123,Ut=5125,L=3553,Wt=33984,Gt=6408,Kt=32856,qt=10240,Jt=10241,Yt=10242,Xt=10243,Zt=9729,Qt=10497,$t=33071,R=36160,en=36064,tn=36053,nn=16384,rn=3042,an=2884,on=2929,sn=2960,cn=3089,ln=3024,un=32774,dn=32776,fn=32769,pn=32771,mn=35048,hn=1024,gn=7680,_n=7681;function z(e){return`id`in e&&typeof e.id==`number`?{id:e.id}:e}function vn(e,t,n){let r=e.createShader(t);if(r===null)throw Error(`The hologram's GPU passes could not make a shader.`);if(e.shaderSource(r,`#version 300 es\n${n}`),e.compileShader(r),e.getShaderParameter(r,35713)!==!0){let t=e.getShaderInfoLog(r);throw e.deleteShader(r),Error(`The hologram's GPU shader did not compile: ${t}`)}return r}function yn(e,t,n,r){let i=e.createProgram();if(i===null)throw Error(`The hologram's GPU passes could not make a program.`);let a=vn(e,It,t),o=vn(e,Lt,n);if(e.attachShader(i,a),e.attachShader(i,o),e.linkProgram(i),e.deleteShader(a),e.deleteShader(o),e.getProgramParameter(i,35714)!==!0){let t=e.getProgramInfoLog(i);throw e.deleteProgram(i),Error(`The hologram's GPU program did not link: ${t}`)}let s={};for(let t of r){let n=e.getUniformLocation(i,t);s[t]=n===null?null:z(n)}return{program:z(i),uniforms:s}}function B(e,t,n){let r=e.createBuffer();if(r===null)throw Error(`The hologram's GPU passes could not make a buffer.`);return e.bindBuffer(t,r),e.bufferData(t,n,zt),r}function bn(e,t,n,r){let i=e.createVertexArray();if(i===null)throw Error(`The hologram's GPU passes could not make a vertex array.`);e.bindVertexArray(i);for(let[r,i,a]of n){let n=e.getAttribLocation(t,r);n<0||(e.bindBuffer(I,i),e.enableVertexAttribArray(n),e.vertexAttribPointer(n,a,Bt,!1,0,0))}return e.bindBuffer(Rt,r),e.bindVertexArray(null),i}function xn(e,t){let n=e.createTexture();if(n===null)throw Error(`The hologram's GPU passes could not make a texture.`);return e.bindTexture(L,n),e.texParameteri(L,Jt,Zt),e.texParameteri(L,qt,Zt),e.texParameteri(L,Yt,t),e.texParameteri(L,Xt,t),n}var V={colour:13653532,dim:{width:.11,strength:.18},mid:{width:.12,strength:.24},bright:{width:.16,strength:.65}},Sn=2,Cn=`
precision highp float;
precision highp int;

// One texel, in the drawing's unit, and his radius as a share of the square the target covers.
uniform float texelUnits;
uniform float radiusFraction;

in vec2 corner;

${kt}
${At}

out vec2 local;
flat out vec4 glyphShape;
flat out float haloRadius;
flat out float shellLight;

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
  float width = fragment.tier > 1.5 ? ${P(V.bright.width)} : (fragment.tier > 0.5 ? ${P(V.mid.width)} : ${P(V.dim.width)});
  haloRadius = 0.5 * width * perspective;
  local = corner * (glyphReach(fragment.glyph, halfLength, normalLength) + haloRadius + 1.5 * texelUnits);
  glyphShape = vec4(fragment.glyph, halfLength, normalLength, fragment.tier);
  shellLight = fragment.light;

  // Into the target: the globe's half on the left, and every group held in the view plane — the
  // whorl, the arcs and the truss — in the right, y up as a texture's rows go.
  vec2 point = centre + along * local.x + across * local.y;
  vec2 share = vec2(0.5 + point.x * radiusFraction, 0.5 - point.y * radiusFraction);
  gl_Position = vec4(share.x - 1.0 + min(fragment.group, 1.0), 2.0 * share.y - 1.0, 0.0, 1.0);
}
`,wn=`
precision highp float;
precision highp int;

in vec2 local;
flat in vec4 glyphShape;
flat in float haloRadius;
flat in float shellLight;

out vec4 colour;

${At}

void main() {
  float reached = glyphLineDistance(local, glyphShape.x, glyphShape.y, glyphShape.z) / haloRadius;
  if (reached >= 1.0) discard;
  float covered = pow(1.0 - reached, ${P(Sn)}) * shellLight;
  float tier = glyphShape.w;
  colour = vec4(tier < 0.5 ? covered : 0.0, tier > 0.5 && tier < 1.5 ? covered : 0.0, tier > 1.5 ? covered : 0.0, 0.0);
}
`;function Tn(e,t,n=512){"worklet";return t.radiusFraction=e,t.texelUnits=1/(e*n),t}var En=`
uniform sampler2D halo;
// The halo tiers' strengths (dim, mid, bright) times the voice's glow; all 0 with no halo pass.
uniform vec3 haloShares;

const vec3 HALO = ${Tt(V.colour)};

// What is left of the light behind once one tier's halo is Screened over it.
vec3 through(float covered, float share) {
  return vec3(1.0) - HALO * (share * covered);
}

// The halo union's two groups, each tier Screened over the rest.
vec3 haloGlow(vec2 coordinate) {
  vec3 pinned = texture(halo, vec2(coordinate.x * 0.5, coordinate.y)).rgb;
  vec3 turning = texture(halo, vec2(0.5 + coordinate.x * 0.5, coordinate.y)).rgb;
  vec3 left = through(pinned.r, haloShares.x) * through(pinned.g, haloShares.y) * through(pinned.b, haloShares.z)
    * through(turning.r, haloShares.x) * through(turning.g, haloShares.y) * through(turning.b, haloShares.z);
  return vec3(1.0) - left;
}
`;function Dn(e,t){"worklet";return t[0]=V.dim.strength*e,t[1]=V.mid.strength*e,t[2]=V.bright.strength*e,t}var On=`
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
`,kn=`
precision highp float;

uniform float alphaFromLight;

in vec2 haloCoordinate;

out vec4 colour;

${En}

void main() {
  vec3 glow = haloGlow(haloCoordinate);
  colour = vec4(glow, alphaFromLight * max(glow.r, max(glow.g, glow.b)));
}
`,An=[-1,-1,1,-1,1,1,-1,1],jn=[0,1,2,0,2,3],Mn=65535,Nn=[[`rest`,4],[`shape`,4],[`hashes`,4],[`identity`,3],[`thinning`,1]];function Pn(e,t){"worklet";let n=Math.fround(t),r=0,i=e.length;for(;r<i;){let t=r+i>>>1;e[t]<n?r=t+1:i=t}return r}function Fn(e,t){let n=e.length/t,r=new Float32Array(e.length*4);r.set(e);for(let e=n-1;e>=0;e--){let n=e*t,i=n*4;r.copyWithin(i,n,n+t),r.copyWithin(i+t,i,i+t),r.copyWithin(i+2*t,i,i+2*t)}return r}function In(e){let t=new Float32Array(e*An.length);if(e===0)return t;t.set(An);for(let e=An.length;e<t.length;e*=2)t.copyWithin(e,0,e);return t}function Ln(e){let t=e.slice().sort(),n=new Map;for(let e=t.length-1;e>=0;e--)n.set(t[e],e);let r=new Uint32Array(e.length);for(let t=0;t<e.length;t++){let i=e[t],a=n.get(i);if(a===void 0)throw Error(`row ${t}'s density key ${i} is not among the sorted keys`);r[t]=a,n.set(i,a+1)}return r}function Rn(e){let t=Nn.map(([t,n])=>({name:t,size:n,values:Fn(e[t],n)})),n=In(e.count),r=e.count*4,i=e.count*jn.length,a=r<=Mn?new Uint16Array(i):new Uint32Array(i),{thinning:o}=e,s=Ln(o),c=new Float32Array(e.count);for(let t=0;t<e.count;t++){let e=s[t];c[e]=o[t];let n=e*jn.length,r=t*4;for(let e=0;e<jn.length;e++)a[n+e]=r+jn[e]}return{vertexCount:r,attributes:t,corner:n,index:a,keys:c}}var zn=new Float32Array([-1,1,1,1,-1,-1,1,-1]),Bn=new Uint16Array([0,2,1,2,3,1]),Vn=Object.keys(Et()),Hn=[...Vn,`texelUnits`,`radiusFraction`],Un=[...Vn,`modelViewMatrix`,`projectionMatrix`,`viewportHeight`,`unitMetres`,`sparkle`,`alphaFromLight`],Wn=[`modelViewMatrix`,`projectionMatrix`,`viewRight`,`viewUp`,`halfSide`,`halo`,`haloShares`,`alphaFromLight`];function Gn(e,t,n={}){let r=n.haloTexels??512,i=ot(t),a=Rn(i),o=yn(e,Cn,wn,Hn),s=yn(e,Pt,Ft,Un),c=yn(e,On,kn,Wn),l=a.attributes.map(({name:t,size:n,values:r})=>[t,B(e,I,r),n]);l.push([`corner`,B(e,I,a.corner),2]);let u=B(e,Rt,a.index),d=bn(e,o.program,l,u),f=bn(e,s.program,l,u),p=B(e,I,zn),m=B(e,Rt,Bn),h=bn(e,c.program,[[`corner`,p,2]],m),g=xn(e,Qt);e.texImage2D(L,0,Kt,64,64,0,Gt,Vt,Mt(t));let _=xn(e,$t);e.texImage2D(L,0,Kt,r*2,r,0,Gt,Vt,null),e.bindTexture(L,null);let v=e.createFramebuffer();if(v===null)throw Error(`The GPU body could not make a framebuffer.`);e.bindFramebuffer(R,v),e.framebufferTexture2D(R,en,L,_,0);let y=e.checkFramebufferStatus(R)===tn;if(e.bindFramebuffer(R,null),!y)throw Error(`The GPU body could not render into its halo target.`);return{haloTexels:r,rowCount:i.count,indexCount:a.index.length,indexType:a.index instanceof Uint16Array?Ht:Ut,quadKeys:a.keys,fragmentUniforms:Et(),haloPlacement:{texelUnits:0,radiusFraction:0},shares:[0,0,0],haloUnion:o,strokes:s,haloLight:c,haloUnionArray:z(d),strokeArray:z(f),squareArray:z(h),sparkle:z(g),haloTexture:z(_),haloFramebuffer:z(v)}}function H(e,t,n){"worklet";t!=null&&(typeof n==`number`?e.uniform1f(t,n):n.length===2?e.uniform2f(t,n[0],n[1]):n.length===3?e.uniform3f(t,n[0],n[1],n[2]):n.length===4&&e.uniform4f(t,n[0],n[1],n[2],n[3]))}function Kn(e,t,n){"worklet";for(let r=0;r<Vn.length;r++){let i=Vn[r];H(e,t.uniforms[i],n[i].value)}}function qn(e,t,n,r){"worklet";let i=Tn(n,t.haloPlacement,t.haloTexels);e.bindFramebuffer(R,t.haloFramebuffer),e.viewport(0,0,t.haloTexels*2,t.haloTexels),e.clear(nn),e.enable(rn),e.blendEquationSeparate(dn,dn),e.blendFuncSeparate(1,1,1,1);let a=t.haloUnion;e.useProgram(a.program),Kn(e,a,t.fragmentUniforms),H(e,a.uniforms.texelUnits,i.texelUnits),H(e,a.uniforms.radiusFraction,i.radiusFraction),e.bindVertexArray(t.haloUnionArray),e.drawElements(4,r,t.indexType,0)}function Jn(e,t,n,r){"worklet";let{camera:i}=n,a=t.strokes;e.useProgram(a.program),Kn(e,a,t.fragmentUniforms),e.uniformMatrix4fv(a.uniforms.modelViewMatrix,!1,i.modelView),e.uniformMatrix4fv(a.uniforms.projectionMatrix,!1,i.projection),H(e,a.uniforms.viewportHeight,Math.max(1,i.height)),H(e,a.uniforms.unitMetres,i.unitLength),H(e,a.uniforms.alphaFromLight,n.alphaFromLight),e.activeTexture(Wt),e.bindTexture(L,t.sparkle),e.uniform1i(a.uniforms.sparkle,0),e.bindVertexArray(t.strokeArray),e.drawElements(4,r,t.indexType,0)}function Yn(e,t,n){"worklet";let{camera:r,state:i}=n,a=t.haloLight;e.useProgram(a.program),e.uniformMatrix4fv(a.uniforms.modelViewMatrix,!1,r.modelView),e.uniformMatrix4fv(a.uniforms.projectionMatrix,!1,r.projection),H(e,a.uniforms.viewRight,t.fragmentUniforms.viewRight.value),H(e,a.uniforms.viewUp,t.fragmentUniforms.viewUp.value),H(e,a.uniforms.halfSide,.5/i.radius),H(e,a.uniforms.haloShares,Dn(i.glowGain,t.shares)),H(e,a.uniforms.alphaFromLight,n.alphaFromLight),e.activeTexture(Wt),e.bindTexture(L,t.haloTexture),e.uniform1i(a.uniforms.halo,0),e.bindVertexArray(t.squareArray),e.drawElements(4,Bn.length,Ht,0)}function Xn(e){"worklet";e.disable(on),e.disable(an),e.disable(sn),e.disable(cn),e.disable(ln)}function Zn(e){"worklet";return e.fade>0&&e.state.arrival>0}function Qn(e,t,n){"worklet";if(Xn(e),!Zn(n))return;let{state:r,camera:i}=n;Ot(t.fragmentUniforms,r,i.basis,n.density,i.eyeDistance),qn(e,t,r.radius,Pn(t.quadKeys,n.density)*6)}function $n(e,t,n){"worklet";if(!Zn(n))return;let{camera:r}=n;e.disable(sn),e.bindFramebuffer(R,null),e.viewport(0,0,r.width,r.height),e.enable(rn),e.blendEquationSeparate(un,un),e.blendFuncSeparate(fn,769,pn,771),e.blendColor(n.fade,n.fade,n.fade,n.fade),Jn(e,t,n,Pn(t.quadKeys,n.density)*6),Yn(e,t,n),e.bindVertexArray(null),e.bindTexture(L,null),e.disable(rn)}function er(e,t,n){"worklet";Xn(e),e.bindFramebuffer(R,null),e.clearColor(0,0,0,0),e.clear(nn),Qn(e,t,n),$n(e,t,n)}var tr={solid:0,sparkle:1,radial:2},nr=`
const float TAU = 6.283185307179586;
const float DEGREES = 0.017453292519943295;

float clamp01(float value) {
  return clamp(value, 0.0, 1.0);
}

float smooth01(float value) {
  float clamped = clamp01(value);
  return clamped * clamped * (3.0 - 2.0 * clamped);
}

float fraction(float value) {
  return value - floor(value);
}

// A clock angle, degrees clockwise from 12 o'clock, as radians from 3 o'clock with y down.
float clockRadians(float clockDegrees) {
  return (clockDegrees - 90.0) * DEGREES;
}

// The drawing's repeatable hash of an integer, 0 to 1: Math.imul's arithmetic is a uint's.
float hashInteger(float value) {
  uint mixed = uint(int(value)) * 0x9e3779b1u;
  mixed ^= mixed >> 15u;
  mixed *= 0x85ebca77u;
  mixed ^= mixed >> 13u;
  return float(mixed) / 4294967296.0;
}
`,rr=`
precision highp float;
precision highp int;

// The draw's local frame to the square the picture fills, 0 to 1 across and y down, and how many of
// its units a device pixel is.
uniform mat3 toSquare;
uniform float localPerPixel;

// Each shape's quad: its corner at ±1, along it and across it.
in vec2 corner;

out vec2 local;
flat out vec4 shapeA;
flat out vec4 shapeB;
flat out vec4 shapeC;
flat out float shapeKind;
// How lit the shape is at this corner, 0 to 1, as a share of its paint: 1 unless its layer says.
out float shapeLight;

${nr}
${`
// The latest burst: its age, number, reach and strength.
uniform vec4 burst;

bool chipShard(
  float chip,
  float shard,
  float piece,
  float hotCore,
  out vec2 tail,
  out vec2 head,
  out float thinning,
  out float light
) {
  tail = vec2(0.0);
  head = vec2(0.0);
  thinning = 1.0;
  light = 0.0;
  float age = burst.x;
  float count = burst.y;
  float reach = burst.z;
  // a small onset throws three chips, a loud one five
  if (chip >= 3.0 + floor(reach * 2.0 + 0.5)) return false;
  float size = 0.78 + 0.22 * reach;
  bool split = hashInteger(count * 53.0 + 1.0) < 0.33;
  float base = 255.0 + hashInteger(count * 131.0 + 7.0) * 35.0;
  float flight = age / ${P(fe)};
  float breakUp = clamp01((age - ${P(g)}) / ${P(fe-g)});
  float seed = count * 211.0 + chip * 17.0;
  bool upper = split && mod(chip, 2.0) == 0.0;
  bool leads = chip == 0.0;
  float centre = split ? (upper ? 300.0 : 250.0) : base;
  float launch = centre + (hashInteger(seed) - 0.5) * (split ? 16.0 : 52.0);
  // A chip is a few shards: its first the main streak, the others splinters thrown a few degrees to
  // either side of it, a little slower, and shorter.
  float shardSeed = seed + shard * 37.0 + 3.0;
  float splinter = shard > 0.5 ? 1.0 : 0.0;
  float clock = launch
    + splinter * (hashInteger(shardSeed) - 0.5) * 12.0
    - (upper ? 14.0 : 8.0 + 14.0 * hashInteger(seed + 5.0)) * flight;
  float speed = (leads ? 1.6 + 0.7 * hashInteger(seed + 3.0) : 0.9 + 1.2 * hashInteger(seed + 3.0))
    * (1.0 - splinter * (0.15 + 0.25 * hashInteger(shardSeed + 1.0)));
  float chipSize = size * (leads ? 1.05 : 0.6 + 0.35 * hashInteger(seed + 9.0));
  float angle = clockRadians(clock);
  vec2 outward = vec2(cos(angle), sin(angle));
  // Each leans a little off straight out, as light thrown off a turning edge does.
  float lean = (hashInteger(shardSeed + 2.0) - 0.5) * 0.7;
  vec2 along = vec2(outward.x * cos(lean) - outward.y * sin(lean), outward.x * sin(lean) + outward.y * cos(lean));
  float headRadius = ${P(A+.06)} + speed * age;
  float streak = chipSize
    * (splinter > 0.5 ? 0.06 + 0.05 * hashInteger(shardSeed + 4.0) : 0.17 + 0.09 * hashInteger(seed + 7.0))
    * (1.0 - 0.3 * breakUp);
  // It streaks back along the way it came, but never from inside the edge it left.
  streak = min(streak, headRadius - ${P(A-.02)});
  // Breaking up, it snaps in two, and the pieces draw apart, thin and fade as they go.
  float pieces = breakUp > 0.0 ? 2.0 : 1.0;
  if (streak < 0.01 || piece >= pieces) return false;
  float gap = breakUp * streak * 0.35;
  float pieceLength = pieces == 1.0 ? streak : (streak - gap) * 0.5;
  head = outward * headRadius - along * (piece == 0.0 ? 0.0 : pieceLength + gap);
  // its white-hot core is the front half of it
  tail = head - along * pieceLength * (hotCore > 0.5 ? 0.5 : 1.0);
  thinning = 1.0 - 0.45 * breakUp;
  light = 1.0 - 0.6 * breakUp * breakUp;
  return true;
}
`}
void place(vec2 at) {
  local = at;
  vec2 square = (toSquare * vec3(at, 1.0)).xy;
  gl_Position = vec4(square.x * 2.0 - 1.0, 1.0 - square.y * 2.0, 0.0, 1.0);
}

// A shape not drawn this frame: every corner outside the clip volume, so nothing is rasterised.
void hide() {
  local = vec2(0.0);
  shapeA = vec4(0.0);
  shapeB = vec4(0.0);
  shapeC = vec4(0.0);
  shapeKind = 0.0;
  shapeLight = 0.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}

// A straight run of a path from one point to another. Where it meets the run before it (\`joins\` 1)
// or after it (\`joins\` 2, both 3) its end is round, which is the path's round join drawn by the two
// runs together (a pixel they share is painted once, as the one that covers it more: see
// \`drawShapes\`); where it is the path's own end the end is round or cut square (butt), as Skia's
// caps are.
void emitRun(vec2 from, vec2 to, float halfWidth, float joins, float roundStart, float roundEnd) {
  vec2 run = to - from;
  float runLength = length(run);
  bool joinedBefore = mod(joins, 2.0) > 0.5;
  bool joinedAfter = joins > 1.5;
  float startRound = joinedBefore ? 1.0 : roundStart;
  float endRound = joinedAfter ? 1.0 : roundEnd;
  // A butt-capped run of no length is not drawn at all, as Skia draws none.
  if (runLength < 1e-6 && startRound < 0.5 && endRound < 0.5) {
    hide();
    return;
  }
  vec2 along = runLength > 0.0 ? run / runLength : vec2(1.0, 0.0);
  vec2 across = vec2(-along.y, along.x);
  float reach = halfWidth + localPerPixel;
  vec2 end = corner.x < 0.0
    ? from - along * (startRound > 0.5 ? reach : localPerPixel)
    : to + along * (endRound > 0.5 ? reach : localPerPixel);
  shapeKind = 1.0;
  shapeA = vec4(from, to);
  shapeB = vec4(halfWidth, roundStart, roundEnd, joins);
  shapeC = vec4(0.0);
  shapeLight = 1.0;
  place(end + across * corner.y * reach);
}

// A run that is a path of its own.
void emitSegment(vec2 from, vec2 to, float halfWidth, float roundStart, float roundEnd) {
  emitRun(from, to, halfWidth, 0.0, roundStart, roundEnd);
}

// One of \`pieces\` equal pieces of a circular arc from \`start\` through \`sweep\` radians (y down, so
// a positive sweep is clockwise): an arc is drawn as several quads so that none of them covers much
// more than the band itself. Each quad's sides run straight out from the centre along its own first
// and last angle, and a piece's neighbour starts on the very line it ends on, so the quads never
// overlap and every pixel between them is the rasteriser's to give to one or the other.
void emitArcPiece(
  vec2 centre,
  float radius,
  float halfWidth,
  float start,
  float sweep,
  float piece,
  float pieces,
  float roundStart,
  float roundEnd
) {
  if (sweep == 0.0 || radius <= 0.0) {
    hide();
    return;
  }
  if (sweep < 0.0) {
    start += sweep;
    sweep = -sweep;
    float swapped = roundStart;
    roundStart = roundEnd;
    roundEnd = swapped;
  }
  float whole = sweep >= TAU ? 1.0 : 0.0;
  sweep = min(sweep, TAU);
  float pieceSweep = sweep / pieces;
  float from = start + pieceSweep * piece;
  float to = from + pieceSweep;
  float reach = halfWidth + localPerPixel;
  // Round caps and the antialiasing reach a little past the arc's two ends.
  float before = whole < 0.5 && piece < 0.5 ? min((roundStart > 0.5 ? reach : localPerPixel) / radius, 0.6) : 0.0;
  float after = whole < 0.5 && piece > pieces - 1.5 ? min((roundEnd > 0.5 ? reach : localPerPixel) / radius, 0.6) : 0.0;
  float first = from - before;
  float last = to + after;
  float halfSpan = (last - first) * 0.5;
  float inner = max(radius - reach, 0.0);
  float outer = (radius + reach) / cos(halfSpan);
  float angle = corner.x < 0.0 ? first : last;
  shapeKind = 2.0;
  shapeA = vec4(centre, radius, halfWidth);
  shapeB = vec4(start, sweep, roundStart, roundEnd + 2.0 * whole);
  shapeC = vec4(piece, pieces, 0.0, 0.0);
  shapeLight = 1.0;
  place(centre + vec2(cos(angle), sin(angle)) * (corner.y < 0.0 ? inner : outer));
}

// A filled circle.
void emitDisc(vec2 centre, float radius) {
  float reach = radius + localPerPixel;
  shapeKind = 3.0;
  shapeA = vec4(centre, radius, 0.0);
  shapeB = vec4(0.0);
  shapeC = vec4(0.0);
  shapeLight = 1.0;
  place(centre + corner * reach);
}
`,ir=.99/256;function ar(e){"worklet";return(256-e)/256}var or=1024,sr=`
precision highp float;
precision highp int;

uniform float localPerPixel;
// The paint: its colour premultiplied by its alpha, or (alpha, alpha, alpha, alpha) under a gradient.
uniform vec4 paintColour;
uniform int paintKind;
uniform sampler2D sparkle;
uniform sampler2D gradients;
// The radial gradient's row, and the radius it reaches its end at.
uniform vec2 gradient;
// Where the path's band of depths starts.
uniform float pathDepth;

in vec2 local;
flat in vec4 shapeA;
flat in vec4 shapeB;
flat in vec4 shapeC;
flat in float shapeKind;
in float shapeLight;

out vec4 colour;

${nr}
const float PATH_DEPTH_SPAN = ${P(ir)};

// How much of a pixel a band \`halfPixels\` either side of a line covers, \`distancePixels\` from it:
// the band's width box-filtered over the pixel, so a band under a pixel wide covers its area.
float band(float distancePixels, float halfPixels) {
  float away = abs(distancePixels);
  return clamp(halfPixels + 0.5 - away, 0.0, 1.0) - clamp(0.5 - halfPixels - away, 0.0, 1.0);
}

// How far a point is from a run with round ends.
float capsuleDistance(vec2 point, vec2 from, vec2 to) {
  vec2 run = to - from;
  float share = clamp(dot(point - from, run) / max(dot(run, run), 1e-12), 0.0, 1.0);
  return length(point - from - run * share);
}

float segmentCoverage(vec2 point) {
  vec2 from = shapeA.xy;
  vec2 to = shapeA.zw;
  float halfPixels = shapeB.x / localPerPixel;
  bool joinedBefore = mod(shapeB.w, 2.0) > 0.5;
  bool joinedAfter = shapeB.w > 1.5;
  vec2 run = to - from;
  float runLength = length(run);
  vec2 along = runLength > 0.0 ? run / runLength : vec2(1.0, 0.0);
  vec2 offset = point - from;
  float alongPoint = dot(offset, along);
  bool buttBefore = !joinedBefore && shapeB.y < 0.5;
  bool buttAfter = !joinedAfter && shapeB.z < 0.5;
  // Past a butt end only the band across the run reaches, cut square; elsewhere the run is round.
  float away = (buttBefore && alongPoint < 0.0) || (buttAfter && alongPoint > runLength)
    ? abs(dot(offset, vec2(-along.y, along.x)))
    : capsuleDistance(point, from, to);
  float covered = band(away / localPerPixel, halfPixels);
  if (buttBefore) covered *= clamp(alongPoint / localPerPixel + 0.5, 0.0, 1.0);
  if (buttAfter) covered *= clamp((runLength - alongPoint) / localPerPixel + 0.5, 0.0, 1.0);
  return covered;
}

float arcCoverage(vec2 point) {
  vec2 centre = shapeA.xy;
  float radius = shapeA.z;
  float halfPixels = shapeA.w / localPerPixel;
  float start = shapeB.x;
  float sweep = shapeB.y;
  float whole = shapeB.w >= 1.5 ? 1.0 : 0.0;
  float roundStart = shapeB.z;
  float roundEnd = shapeB.w - 2.0 * whole;
  vec2 offset = point - centre;
  float fromCentre = length(offset);
  // The pieces' quads meet edge to edge, so a pixel is drawn by whichever quad the rasteriser gave it
  // to, and no piece asks which of them the pixel's angle belongs to. It used to: a pixel whose centre
  // lay on the line two pieces meet on — every pixel on a 45-degree diagonal through a circle centred
  // on a pixel corner, as the aura is — was rasterised by one quad while the angle, worked out in
  // floating point, gave it to the other, so neither painted it, and the aura showed a dark line
  // down each lower diagonal.
  if (whole > 0.5) return band((fromCentre - radius) / localPerPixel, halfPixels);
  // How far round from the start this pixel is, 0 to a turn.
  float turned = mod(atan(offset.y, offset.x) - start, TAU);
  if (turned <= sweep) {
    float covered = band((fromCentre - radius) / localPerPixel, halfPixels);
    if (roundStart < 0.5) covered *= clamp(turned * fromCentre / localPerPixel + 0.5, 0.0, 1.0);
    if (roundEnd < 0.5) covered *= clamp((sweep - turned) * fromCentre / localPerPixel + 0.5, 0.0, 1.0);
    return covered;
  }
  // Past the arc's ends only the end pieces' quads reach, and each draws its own end: the gap past
  // the arc is split at its middle, the start's piece taking the half nearer the start.
  float gapMiddle = sweep + (TAU - sweep) * 0.5;
  bool nearStart = turned >= gapMiddle;
  bool isFirst = shapeC.x < 0.5;
  bool isLast = shapeC.x > shapeC.y - 1.5;
  if (nearStart ? !isFirst : !isLast) return 0.0;
  float endAngle = nearStart ? start : start + sweep;
  float isRound = nearStart ? roundStart : roundEnd;
  if (isRound > 0.5) {
    vec2 end = centre + vec2(cos(endAngle), sin(endAngle)) * radius;
    return band(length(point - end) / localPerPixel, halfPixels);
  }
  float beyond = (nearStart ? TAU - turned : turned - sweep) * fromCentre / localPerPixel;
  return band((fromCentre - radius) / localPerPixel, halfPixels) * clamp(0.5 - beyond, 0.0, 1.0);
}

float discCoverage(vec2 point) {
  float signedDistance = length(point - shapeA.xy) - shapeA.z;
  return clamp(0.5 - signedDistance / max(fwidth(signedDistance), 1e-6), 0.0, 1.0);
}

vec4 gradientAt(float row, float position) {
  float texel = clamp(position, 0.0, 1.0) * ${P(1023)} + 0.5;
  return texture(gradients, vec2(texel / ${P(or)}, (row + 0.5) / ${P(2)}));
}

void main() {
  float shapeCovered = shapeKind < 1.5
    ? segmentCoverage(local)
    : shapeKind < 2.5
      ? arcCoverage(local)
      : discCoverage(local);
  // How lit a shape is counts as how much it covers, so where a path's shapes overlap the one
  // that lights a pixel most is the one painted there.
  float covered = shapeCovered * clamp(shapeLight, 0.0, 1.0);
  if (covered < 0.001) discard;
  // Within its path's own band of depths, nearer the more it covers: see \`drawShapes\`.
  gl_FragDepth = pathDepth - covered * PATH_DEPTH_SPAN;
  vec4 paint = paintColour;
  if (paintKind == ${tr.sparkle}) {
    paint.rgb *= texture(sparkle, local / ${P(jt)}).r;
  } else if (paintKind == ${tr.radial}) {
    paint *= gradientAt(gradient.x, length(local) / gradient.y);
  }
  colour = paint * covered;
}
`,cr=12,lr=.2;function ur(e){"worklet";return e===77||e===109||e===76||e===108||e===72||e===104||e===86||e===118||e===65||e===97||e===67||e===99||e===81||e===113||e===90||e===122}function dr(e){"worklet";return e>=48&&e<=57||e===45||e===46||e===43}function fr(e){"worklet";return e>=48&&e<=57}function pr(e,t){"worklet";let n=t;for(;n<e.length&&fr(e.charCodeAt(n));)n++;return n}function mr(e,t){"worklet";let n=pr(e,t+1);return e[t]!==`.`&&e[n]===`.`&&(n=pr(e,n+1)),(e[n]===`e`||e[n]===`E`)&&(n++,(e[n]===`-`||e[n]===`+`)&&n++,n=pr(e,n)),n}function hr(e,t,n){"worklet";return e.toLowerCase()===`a`&&(t%7==3||t%7==4)&&(n===48||n===49)}function gr(e){"worklet";let t=[],n=0,r=0,i=``;for(;n<e.length;){let a=e.charCodeAt(n);if(ur(a))i=e[n],t.push(i),r=0,n++;else if(!dr(a))n++;else{let o=hr(i,r,a)?n+1:mr(e,n);t.push(Number(e.slice(n,o))),r++,n=o}}return t}function _r(e,t,n){"worklet";e.push(t,n)}function vr(e,t,n){"worklet";let r=t.length/2;if(r<2)return;let i=r-1;for(let a=1;a<r;a++){let r=a>1||n,o=a<i||n;e.push(t[(a-1)*2],t[(a-1)*2+1],t[a*2],t[a*2+1],+!!r+(o?2:0))}}function yr(e,t,n,r,i,a,o,s,c,l){"worklet";let u=Math.abs(r),d=Math.abs(i);if(u===0||d===0||t===c&&n===l){_r(e,c,l);return}let f=a*Math.PI/180,p=Math.cos(f),m=Math.sin(f),h=(t-c)/2,g=(n-l)/2,_=p*h+m*g,v=-m*h+p*g,y=_*_/(u*u)+v*v/(d*d);y>1&&(u*=Math.sqrt(y),d*=Math.sqrt(y));let b=u*u*d*d-u*u*v*v-d*d*_*_,x=u*u*v*v+d*d*_*_,ee=Math.sqrt(Math.max(0,b/x))*(o===s?-1:1),S=ee*u*v/d,C=-ee*d*_/u,te=p*S-m*C+(t+c)/2,w=m*S+p*C+(n+l)/2,ne=Math.atan2((v-C)/d,(_-S)/u),T=Math.atan2((-v-C)/d,(-_-S)/u)-ne;s===0&&T>0&&(T-=Math.PI*2),s===1&&T<0&&(T+=Math.PI*2);let E=Math.max(1,Math.ceil(Math.abs(T)/lr));for(let t=1;t<=E;t++){let n=ne+T*t/E,r=Math.cos(n)*u,i=Math.sin(n)*d;_r(e,t===E?c:te+p*r-m*i,t===E?l:w+m*r+p*i)}}function br(e,t,n,r,i,a,o,s,c){"worklet";for(let l=1;l<=cr;l++){let u=l/cr,d=1-u;_r(e,d*d*d*t+3*d*d*u*r+3*d*u*u*a+u*u*u*s,d*d*d*n+3*d*d*u*i+3*d*u*u*o+u*u*u*c)}}function U(e,t){"worklet";let n=e[t];return typeof n==`number`?n:NaN}function xr(e,t,n,r,i,a){"worklet";let o=i+U(t,n),s=a+U(t,n+1);return r?(vr(e.runs,e.points,!1),e.points=[o,s],e.startX=o,e.startY=s):_r(e.points,o,s),e.x=o,e.y=s,n+2}function Sr(e,t,n,r,i){"worklet";let a=r+U(t,n),o=i+U(t,n+1),s=r+U(t,n+2),c=i+U(t,n+3);return br(e.points,e.x,e.y,e.x+(a-e.x)*2/3,e.y+(o-e.y)*2/3,s+(a-s)*2/3,c+(o-c)*2/3,s,c),e.x=s,e.y=c,n+4}function Cr(e,t,n,r,i){"worklet";let a=r+U(t,n+4),o=i+U(t,n+5);return br(e.points,e.x,e.y,r+U(t,n),i+U(t,n+1),r+U(t,n+2),i+U(t,n+3),a,o),e.x=a,e.y=o,n+6}function wr(e,t,n,r,i){"worklet";let a=r+U(t,n+5),o=i+U(t,n+6);return yr(e.points,e.x,e.y,U(t,n),U(t,n+1),U(t,n+2),U(t,n+3),U(t,n+4),a,o),e.x=a,e.y=o,n+7}function Tr(e){"worklet";(e.x!==e.startX||e.y!==e.startY)&&_r(e.points,e.startX,e.startY),vr(e.runs,e.points,e.points.length>4),e.x=e.startX,e.y=e.startY,e.points=[e.x,e.y]}function Er(e,t,n,r){"worklet";let i=r.toLowerCase(),a=r===i?e.x:0,o=r===i?e.y:0;return i===`m`||i===`l`?xr(e,t,n,i===`m`,a,o):i===`h`||i===`v`?(i===`h`?e.x=a+U(t,n):e.y=o+U(t,n),_r(e.points,e.x,e.y),n+1):i===`q`?Sr(e,t,n,a,o):i===`c`?Cr(e,t,n,a,o):i===`a`?wr(e,t,n,a,o):-1}function Dr(e){"worklet";return e===`M`?`L`:e===`m`?`l`:e}function Or(e){"worklet";let t=gr(e),n={x:0,y:0,startX:0,startY:0,points:[],runs:[]},r=``,i=0;for(;i<t.length;){let e=t[i];if(typeof e==`string`)r=e,i++,(r===`Z`||r===`z`)&&Tr(n);else{if(i=Er(n,t,i,r),i<0)return[];r=Dr(r)}}return vr(n.runs,n.points,!1),n.runs.every(Number.isFinite)?n.runs:[]}var kr=.53,W={coreGlow:{row:0,radius:kr},aura:{row:1,radius:k}};function Ar(e,t){return{colours:t.map(([,e])=>e),positions:t.map(([t])=>t/e)}}var jr=Ar(kr,[[0,`#e07c3c76`],[.34*t,`#e4823f7c`],[.63*t,`#ea8a4690`],[.8*t,`#f0964eac`],[.93*t,`#f8a85ecc`],[t,`#ffb878d8`],[t+.025,`#f08e4aa0`],[t+.06,`#e4743458`],[t+.11,`#d8642a1c`],[kr,`#d45a2200`]]),Mr=Ar(k,[[0,`#d45a2200`],[S,`#d45a2200`],[.62,`#dc642810`],[A-.08,`#e672308c`],[A,`#ea7834ff`],[.98,`#e26c2ec0`],[1.12,`#d45a225c`],[1.3,`#bc4c1a1c`],[k,`#a4401600`]]);function Nr(e){let t=e.replace(`#`,``),n=e=>Number.parseInt(t.slice(e,e+2),16)/255;if(!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(t))throw Error(`Not a colour the picture can paint: ${e}`);return[n(0),n(2),n(4),t.length===8?n(6):1]}function Pr(e,t){let{colours:n,positions:r}=e,i=r.length-1,a=0;for(;a<i&&r[a+1]<=t;)a++;let o=Nr(n[a]);if(a===i||t<=r[0]){let e=t<=r[0]?Nr(n[0]):o;return[e[0]*e[3],e[1]*e[3],e[2]*e[3],e[3]]}let s=Nr(n[a+1]),c=r[a+1]-r[a],l=c>0?(t-r[a])/c:0,u=o.map((e,t)=>e+(s[t]-e)*l);return[u[0]*u[3],u[1]*u[3],u[2]*u[3],u[3]]}function Fr(){let e=[[W.coreGlow.row,jr],[W.aura.row,Mr]],t=new Uint8Array(or*2*4);for(let[n,r]of e)for(let e=0;e<or;e++){let i=Pr(r,e/(or-1)),a=(n*or+e)*4;for(let e=0;e<4;e++)t[a+e]=Math.round(i[e]*255)}return t}function G(e,t){return`${rr}\n${e}\nvoid main() {\n${t}\n}\n`}function K(e,t,n){return{name:e,size:t,values:n.flat()}}var Ir=8;function Lr(e,t){let[,n,r,i,a,o]=t,[s,c]=e,l=[];for(let e=1;e<=Ir;e++){let t=e/Ir,u=(1-t)*(1-t),d=2*o*t*(1-t),f=t*t,p=u+d+f;l.push([(u*s+d*n+f*i)/p,(u*c+d*r+f*a)/p])}return l}function Rr(e){let t=[],n=[];for(let r=0;r<e.count;r++){let i=e.commands[r],a=i[0];a===0?(n.length>1&&t.push(n),n=[[i[1],i[2]]]):a===1?n.push([i[1],i[2]]):a===3&&n.push(...Lr(n[n.length-1]??[0,0],i))}return n.length>1&&t.push(n),t}function zr(e){let t=[],n=[];for(let r of Rr(e)){let e=r.length-1,i=e>1&&r[0][0]===r[e][0]&&r[0][1]===r[e][1];for(let a=1;a<=e;a++){let o=a>1||i,s=a<e||i;t.push([...r[a-1],...r[a]]),n.push([+!!o+(s?2:0)])}}return{ends:t,joins:n}}var Br=[`coreRing`,`coreBar`],Vr=G(`
in vec4 ends;
in float joins;
uniform float halfWidth;
`,`
  emitRun(ends.xy, ends.zw, halfWidth, joins, 1.0, 1.0);
`);function Hr(e){let t=[],n=[],r={};for(let i of Br){let a=zr(e[i]);r[i]={first:t.length,count:a.ends.length},t.push(...a.ends),n.push(...a.joins)}return{layer:{vertexShader:Vr,uniforms:[`halfWidth`],attributes:[K(`ends`,4,t),K(`joins`,1,n)],shapes:t.length},ranges:r}}function Ur(){return{vertexShader:G(`
in float piece;
uniform vec4 arc;
uniform vec4 arcEnds;
uniform vec2 arcLumps;
`,`
  // arc: centre, radius, half width; arcEnds: start, sweep, pieces, caps (round = 1).
  if (piece >= arcEnds.z) {
    hide();
    return;
  }
  emitArcPiece(arc.xy, arc.z, arc.w, arcEnds.x, arcEnds.y, piece, arcEnds.z, arcEnds.w, arcEnds.w);
  // arcLumps: how much dimmer its dimmest stretches are than its brightest (0: lit evenly), and how
  // far round they have rolled, in radians. Worked out at each corner, so a lump is smooth along it.
  if (arcLumps.x > 0.0 && shapeKind > 0.5) {
    vec2 offset = local - arc.xy;
    float angle = atan(offset.y, offset.x) - arcLumps.y;
    shapeLight = 1.0 - arcLumps.x * (0.5 + 0.5 * sin(3.0 * angle + 0.6) * sin(2.0 * angle - 1.3));
  }
`),uniforms:[`arc`,`arcEnds`,`arcLumps`],attributes:[K(`piece`,1,Array.from({length:32},(e,t)=>[t]))],shapes:32}}function Wr(){return{vertexShader:G(`
in float shape;
uniform vec3 disc;
`,`
  emitDisc(disc.xy, disc.z);
`),uniforms:[`disc`],attributes:[K(`shape`,1,[[0]])],shapes:1}}var Gr=.006,Kr=.42,qr=.15;function Jr(e){let t=[],n=[],r=[];for(let i=0;i<e.cage.length;i+=10)t.push(e.cage.slice(i,i+3)),n.push(e.cage.slice(i+3,i+6)),r.push(e.cage.slice(i+6,i+10));return{vertexShader:G(`
in vec3 edgeFrom;
in vec3 edgeTo;
in vec4 edgeClock;
uniform vec2 bodyTurn;
uniform float time;
uniform float halfWidth;

// A node where his body's turn has taken it, swaying a little about its place by an amount that
// depends only on where it is, so the edges that share a node sway together and stay joined.
vec3 turnedNode(vec3 node) {
  vec3 sway = vec3(
    sin(time * 0.37 + node.y * 5.3 + node.z * 2.1),
    sin(time * 0.29 + node.z * 4.9 + node.x * 3.3),
    sin(time * 0.33 + node.x * 4.1 + node.y * 2.7)
  ) * ${P(Gr)};
  vec3 at = node + sway;
  return vec3(at.x * bodyTurn.x + at.z * bodyTurn.y, at.y, at.z * bodyTurn.x - at.x * bodyTurn.y);
}

// How lit a turned node is: fainter towards his back, and where it lies across his face.
float nodeLight(vec3 turned) {
  float front = smooth01((turned.z + 1.2) / 2.4);
  float aside = smooth01((length(turned.xy) - 0.3) / 0.55);
  return (0.6 + 0.4 * front) * (0.25 + 0.75 * aside);
}

// How near an edge, seen flat, comes to his core.
float nearestToTheCore(vec2 from, vec2 to) {
  vec2 core = vec2(${P(de)}, ${P(_)});
  vec2 run = to - from;
  float share = clamp(dot(core - from, run) / max(dot(run, run), 1e-6), 0.0, 1.0);
  return length(from + run * share - core);
}
`,`
  // edgeClock: its twinkle's rate (cycles a second) and phase, the edge's weight, and how lit its
  // far end is as a share of its near one's.
  vec3 from = turnedNode(edgeFrom);
  vec3 to = turnedNode(edgeTo);
  float clearOfTheCore = smooth01((nearestToTheCore(from.xy, to.xy) - ${P(Kr)}) / ${P(qr)});
  if (clearOfTheCore <= 0.0) {
    hide();
    return;
  }
  float twinkle = 0.55 + 0.45 * smooth01(0.5 + 0.5 * sin((time * edgeClock.x + edgeClock.y) * TAU));
  emitSegment(from.xy, to.xy, halfWidth, 1.0, 1.0);
  shapeLight = clearOfTheCore * edgeClock.z * twinkle * (corner.x < 0.0 ? nodeLight(from) : edgeClock.w * nodeLight(to));
`),uniforms:[`bodyTurn`,`time`,`halfWidth`],attributes:[K(`edgeFrom`,3,t),K(`edgeTo`,3,n),K(`edgeClock`,4,r)],shapes:t.length}}function Yr(e){let t=[],n=[];for(let r=0;r<e.embers.length;r+=7)t.push(e.embers.slice(r,r+4)),n.push(e.embers.slice(r+4,r+7));return{vertexShader:G(`
in vec4 emberPath;
in vec3 emberMore;
uniform float time;
uniform float share;
uniform float halfWidth;
`,`
  // emberPath: direction (radians), where it starts, how far it drifts, its period; emberMore: its
  // phase, its streak's length and its threshold.
  float gate = clamp01((share - emberMore.z) * 8.0);
  float life = fraction(time / emberPath.w + emberMore.x);
  float shown = gate * smooth01(life / 0.2) * (1.0 - smooth01((life - 0.5) / 0.45));
  if (shown < 0.01) {
    hide();
    return;
  }
  // Out from the shell, and up a little as it goes: y runs down.
  vec2 outward = vec2(cos(emberPath.x), sin(emberPath.x));
  vec2 drifting = outward + vec2(0.0, ${P(-r)});
  vec2 at = outward * emberPath.y + drifting * emberPath.z * life;
  emitSegment(at - normalize(drifting) * emberMore.y, at, halfWidth, 1.0, 1.0);
  shapeLight = shown;
`),uniforms:[`time`,`share`,`halfWidth`],attributes:[K(`emberPath`,4,t),K(`emberMore`,3,n)],shapes:t.length}}function Xr(e){let t=[],n=[],r=[];for(let i=0;i<e.fray.length;i+=5)t.push(e.fray.slice(i,i+4)),n.push([e.fray[i+4],0]),r.push([0]);for(let i=0;i<e.streakArcs.length;i+=6)t.push(e.streakArcs.slice(i,i+4)),n.push(e.streakArcs.slice(i+4,i+6)),r.push([1]);for(let i=0;i<e.limbStreaks.length;i+=5)t.push(e.limbStreaks.slice(i,i+4)),n.push([e.limbStreaks[i+4],0]),r.push([2]);return{vertexShader:G(`
in vec4 frayRow;
in vec2 frayMore;
in float frayKind;
uniform float drive;
uniform float time;
uniform float halfWidth;
`,`
  if (frayKind < 0.5) {
    // A strand: clock angle, sweep (degrees), rate, phase; frayMore.x its threshold.
    float gate = clamp01((drive - frayMore.x) * 5.0);
    float life = fraction(time * frayRow.z + frayRow.w);
    float visible = gate * (1.0 - smooth01((life - 0.55) / 0.35)) * smooth01(life / 0.1);
    if (visible < 0.08) {
      hide();
      return;
    }
    float sweep = frayRow.y * visible * DEGREES;
    float centre = clockRadians(frayRow.x);
    emitArcPiece(vec2(0.0), ${P(A)} + 0.17 * life, halfWidth, centre - sweep / 2.0, sweep, 0.0, 1.0, 0.0, 0.0);
    return;
  }
  if (frayKind < 1.5) {
    // A streak arc: clock centre, radius, sweep, rate; frayMore: phase, threshold.
    float gate = clamp01((drive - frayMore.y) * 4.0);
    float life = fraction(time * frayRow.w + frayMore.x);
    float visible = gate * smooth01(life / 0.2) * (1.0 - smooth01((life - 0.65) / 0.25));
    if (visible < 0.08) {
      hide();
      return;
    }
    float sweep = frayRow.z * visible * DEGREES;
    emitArcPiece(vec2(0.0), frayRow.y, halfWidth, clockRadians(frayRow.x) - sweep / 2.0, sweep, 0.0, 1.0, 0.0, 0.0);
    return;
  }
  // A limb streak: height, length, rate, phase; frayMore.x its threshold. Leaving the shell's edge
  // at about 0.3 R/s, bright head first.
  float gate = clamp01((drive - frayMore.x) * 4.0);
  float life = fraction(time * frayRow.z + frayRow.w);
  float visible = gate * smooth01(life / 0.15) * (1.0 - smooth01((life - 0.6) / 0.3));
  if (visible < 0.08) {
    hide();
    return;
  }
  float y = frayRow.x;
  float head = sqrt(max(${P(A*A)} - y * y, 0.0)) + 0.3 * life;
  emitSegment(vec2(head - frayRow.y * visible, y), vec2(head, y), halfWidth, 0.0, 0.0);
`),uniforms:[`drive`,`time`,`halfWidth`],attributes:[K(`frayRow`,4,t),K(`frayMore`,2,n),K(`frayKind`,1,r)],shapes:t.length}}var Zr=[`streak`,`core`],Qr=5,$r=3,ei=2,ti=.5;function ni(){let e=[],t={};return Zr.forEach((n,r)=>{let i=e.length;for(let t=0;t<Qr;t++)for(let n=0;n<$r;n++)for(let i=0;i<ei;i++)e.push([t,n,i,r]);t[n]={first:i,count:e.length-i}}),{layer:{vertexShader:G(`
in vec4 chipShape;
uniform float halfWidth;
`,`
  // chipShape: which chip, which of its shards, which of that shard's pieces, and whether this is
  // the whole streak or its white-hot core.
  vec2 tail;
  vec2 head;
  float thinning;
  float light;
  if (!chipShard(chipShape.x, chipShape.y, chipShape.z, chipShape.w, tail, head, thinning, light)) {
    hide();
    return;
  }
  emitSegment(tail, head, halfWidth * thinning, 1.0, 1.0);
  shapeLight = light * (corner.x < 0.0 ? ${P(ti)} : 1.0);
`),uniforms:[`burst`,`halfWidth`],attributes:[K(`chipShape`,4,e)],shapes:e.length},ranges:t}}var ri=8,ii=160,ai=16769732,oi=16759936,q=16751174,si=15496242,J=14047778,ci=[`toSquare`,`localPerPixel`,`paintColour`,`paintKind`,`sparkle`,`gradients`,`gradient`,`pathDepth`];function li(e){if(e*4>65535)throw Error(`A layer of the picture has more shapes than a 16-bit index can draw.`);let t=new Float32Array(e*8),n=new Uint16Array(e*6);for(let r=0;r<e;r++)t.set([-1,-1,1,-1,1,1,-1,1],r*8),n.set([0,1,2,0,2,3].map(e=>r*4+e),r*6);return{corners:t,index:n}}function ui(e,t,n,r){let i=new Float32Array(t*4*n);for(let e=0;e<t;e++){let t=r.slice(e*n,(e+1)*n);for(let r=0;r<4;r++)i.set(t,(e*4+r)*n)}return B(e,I,i)}function Y(e,t,n){let r=yn(e,t.vertexShader,sr,[...ci,...t.uniforms]),{corners:i,index:a}=li(t.shapes),o=n??t.attributes.map(({name:n,size:r,values:i})=>[n,ui(e,t.shapes,r,i),r]);o.push([`corner`,B(e,I,i),2]);let s=e.createVertexArray();if(s===null)throw Error(`The picture could not make a vertex array.`);e.bindVertexArray(s);for(let[t,n,i]of o){let a=e.getAttribLocation(r.program,t);a<0||(e.bindBuffer(I,n),e.enableVertexAttribArray(a),e.vertexAttribPointer(a,i,Bt,!1,0,0))}return e.bindBuffer(Rt,B(e,Rt,a)),e.bindVertexArray(null),{program:r,array:z(s),shapes:t.shapes}}function di(e,t){let n=Hr(w()),r=ni(),i=t=>{let n=B(e,I,new Float32Array(5120*t));return e.bufferData(I,new Float32Array(5120*t),mn),n},a=i(4),o=i(1),s={vertexShader:Vr,uniforms:[`halfWidth`],attributes:[],shapes:1280},c=xn(e,Qt);e.texImage2D(L,0,Kt,64,64,0,Gt,Vt,Mt(t));let l=xn(e,$t);return e.texImage2D(L,0,Kt,or,2,0,Gt,Vt,Fr()),e.bindTexture(L,null),{segments:Y(e,n.layer),glyphs:Y(e,s,[[`ends`,a,4],[`joins`,o,1]]),arc:Y(e,Ur()),disc:Y(e,Wr()),cage:Y(e,Jr(t)),embers:Y(e,Yr(t)),fray:Y(e,Xr(t)),chips:Y(e,r.layer),paths:n.ranges,chipParts:r.ranges,sparkle:z(c),gradients:z(l),glyphEnds:z(a),glyphJoins:z(o),glyphSlots:Array(ri).fill(``),glyphRuns:Array(ri).fill(0),matrix:new Float32Array(9),stencil:[0]}}function fi(e){"worklet";return e>0?e>1?1:e:0}function X(e,t){"worklet";let n=t.stencil[0]+1;n>255&&(e.depthMask(!0),e.clear(hn|256),n=1),t.stencil[0]=n,e.stencilFunc(517,n,255)}function pi(e,t,n,r,i,a,o){"worklet";let s=n.program.uniforms;e.useProgram(n.program.program),e.bindVertexArray(n.array);let c=t.matrix;c[0]=r,c[1]=0,c[2]=0,c[3]=0,c[4]=r,c[5]=0,c[6]=i,c[7]=a,c[8]=1,s.toSquare&&e.uniformMatrix3fv(s.toSquare,!1,c),s.localPerPixel&&e.uniform1f(s.localPerPixel,1/(r*o)),s.sparkle&&e.uniform1i(s.sparkle,0),s.gradients&&e.uniform1i(s.gradients,1)}function mi(e,t,n,r){"worklet";pi(e,t,n,r.state.radius,.5,.5,r.pixels)}function hi(e,t,n,r){"worklet";pi(e,t,n,r.state.radius*r.state.shellReach,.5,.5,r.pixels)}function gi(e,t,n,r){"worklet";let i=r.state.radius;pi(e,t,n,i,.5+i*de,.5+i*_,r.pixels)}function _i(e,t,n,r,i){"worklet";let a=t.program.uniforms,o=(r>>16&255)/255,s=(r>>8&255)/255,c=(r&255)/255;a.paintColour&&e.uniform4f(a.paintColour,o*i,s*i,c*i,i),a.paintKind&&e.uniform1i(a.paintKind,n)}function Z(e,t,n,r){"worklet";_i(e,t,tr.solid,n,r)}function vi(e,t,n,r,i){"worklet";let a=t.program.uniforms;a.paintColour&&e.uniform4f(a.paintColour,n,n,n,n),a.paintKind&&e.uniform1i(a.paintKind,tr.radial),a.gradient&&e.uniform2f(a.gradient,r,i)}function Q(e,t,n,r){"worklet";let i=e.program.uniforms[n];i&&t.uniform1f(i,r)}function $(e,t,n,r,i){"worklet";if(i<=0)return;let a=n.program.uniforms.pathDepth;a&&e.uniform1f(a,ar(t.stencil[0])),e.colorMask(!1,!1,!1,!1),e.depthMask(!0),e.depthFunc(513),e.stencilOp(gn,gn,gn),e.drawElements(4,i*6,Ht,r*12),e.colorMask(!0,!0,!0,!0),e.depthMask(!1),e.depthFunc(514),e.stencilOp(gn,gn,_n),e.drawElements(4,i*6,Ht,r*12)}function yi(e,t,n,r,i,a){"worklet";let o=t.segments;Z(e,o,i,a),Q(o,e,`halfWidth`,r),X(e,t),$(e,t,o,n.first,n.count)}function bi(e,t,n,r,i,a){"worklet";let o=t.arc,s=o.program.uniforms;s.arc&&e.uniform4f(s.arc,0,0,n,r),s.arcEnds&&e.uniform4f(s.arcEnds,0,Math.PI*2,32,0),s.arcLumps&&e.uniform2f(s.arcLumps,i,a),$(e,t,o,0,32)}var xi=.24;function Si(e,t,n){"worklet";let r=n.state,i=xi*r.auraAlpha*r.glowGain;if(i<=0)return;let a=t.arc;X(e,t),hi(e,t,a,n),vi(e,a,fi(i),W.aura.row,W.aura.radius),bi(e,t,(S+k)/2,(k-S)/2,0,0)}var Ci=.3;function wi(e,n,r,i,a,o){"worklet";let s=n.arc;X(e,n),gi(e,n,s,r),Z(e,s,a,o),bi(e,n,t,i,Ci,r.state.roll*Math.PI/180)}function Ti(e,t,n){"worklet";let r=n.state,i=r.coreAlpha;if(i<=0)return;let a=i*r.coreDrift,o=a*r.coreGlow,s=t.disc;X(e,t),gi(e,t,s,n),vi(e,s,fi(o),W.coreGlow.row,W.coreGlow.radius),s.program.uniforms.disc&&e.uniform3f(s.program.uniforms.disc,0,0,W.coreGlow.radius),$(e,t,s,0,1);let c=t.paths;gi(e,t,t.segments,n),yi(e,t,c.coreRing,.024/2,q,.3*o),yi(e,t,c.coreRing,.01/2,oi,.6*o),yi(e,t,c.coreBar,.008/2,oi,.16*o),wi(e,t,n,.024/2,q,fi(.7*a)),wi(e,t,n,.009/2,ai,fi(.9*a))}function Ei(e,t,n,r,i,a,o){"worklet";let s=t.cage,c=n.state;X(e,t),hi(e,t,s,n),_i(e,s,i,a,o);let l=s.program.uniforms.bodyTurn;l&&e.uniform2f(l,c.bodyCos,c.bodySin),Q(s,e,`time`,c.time),Q(s,e,`halfWidth`,r/c.shellReach),$(e,t,s,0,s.shapes)}function Di(e,t,n){"worklet";let r=n.state.cageAlpha;r<=0||(Ei(e,t,n,.034/2,tr.solid,J,.15*r),Ei(e,t,n,.011/2,tr.sparkle,oi,fi(.9*r)))}function Oi(e,t,n,r,i,a){"worklet";let o=t.embers,s=n.state;X(e,t),hi(e,t,o,n),Z(e,o,i,a),Q(o,e,`time`,s.time),Q(o,e,`share`,s.emberShare),Q(o,e,`halfWidth`,r/s.shellReach),$(e,t,o,0,o.shapes)}function ki(e,t,n){"worklet";let r=n.state.cageAlpha;r<=0||(Oi(e,t,n,.032/2,J,.32*r),Oi(e,t,n,.011/2,oi,fi(r)))}function Ai(e,t,n,r,i,a){"worklet";let o=t.fray,s=n.state;X(e,t),mi(e,t,o,n),Z(e,o,i,a),Q(o,e,`drive`,s.frayDrive),Q(o,e,`time`,s.time),Q(o,e,`halfWidth`,r),$(e,t,o,0,o.shapes)}function ji(e,t,n){"worklet";n.state.frayDrive<=.02||(Ai(e,t,n,.02/2,J,.22),Ai(e,t,n,.0065/2,q,.75))}function Mi(e,t,n,r,i,a,o){"worklet";let s=t.chips,c=n.state;X(e,t),mi(e,t,s,n),Z(e,s,a,o),Q(s,e,`halfWidth`,i);let l=s.program.uniforms.burst;l&&e.uniform4f(l,c.burstAge,c.burstCount,c.burstReach,c.burstStrength),$(e,t,s,r.first,r.count)}function Ni(e,t,n){"worklet";let r=n.state;if(r.burstAge>=.2||r.burstStrength<=0)return;let i=t.chipParts;Mi(e,t,n,i.streak,.045/2,J,.35),Mi(e,t,n,i.streak,.017/2,q,.95),Mi(e,t,n,i.core,.007/2,ai,.55)}var Pi=1.2;function Fi(e,t,n,r,i,a,o){"worklet";let s=t.arc;X(e,t),gi(e,t,s,n),Z(e,s,a,o),bi(e,t,r,i,0,0)}function Ii(e,n,r){"worklet";let i=r.state;if(i.thinking*i.pulse<=0)return;let a=t+(Pi-t)*i.pulse,o=i.thinking*(1-i.pulse);Fi(e,n,r,a,.05/2,J,.3*o),Fi(e,n,r,a,.012/2,q,.85*o)}function Li(e,t,n,r){"worklet";if(t.glyphSlots[n]===r)return;let i=Or(r);i.length===0&&(i=Or(we));let a=Math.min(ii,i.length/5),o=new Float32Array(a*16),s=new Float32Array(a*4);for(let e=0;e<a;e++)for(let t=0;t<4;t++){for(let n=0;n<4;n++)o[e*16+t*4+n]=i[e*5+n];s[e*4+t]=i[e*5+4]}let c=n*ii*4;e.bindBuffer(I,t.glyphEnds),e.bufferSubData(I,c*16,o),e.bindBuffer(I,t.glyphJoins),e.bufferSubData(I,c*4,s),t.glyphSlots[n]=r,t.glyphRuns[n]=a}function Ri(e,t,n,r,i){"worklet";pi(e,t,n,i.glyphRadius,i.centreX,i.centreY,r.pixels)}function zi(e,t,n,r,i,a,o){"worklet";let s=t.disc;X(e,t),Ri(e,t,s,n,r),Z(e,s,a,o);let c=s.program.uniforms.disc;c&&e.uniform3f(c,0,0,i),$(e,t,s,0,1)}function Bi(e,t,n,r,i,a,o){"worklet";let s=t.glyphs;for(let c=0;c<(o>0?2:1);c++)X(e,t),Ri(e,t,s,n,r),Z(e,s,c===0?si:q,c===0?a*(1-o):a*o),Q(s,e,`halfWidth`,Ze/2),$(e,t,s,i*ii,t.glyphRuns[i])}function Vi(e,t,n,r,i,a){"worklet";let o=t.arc;X(e,t),Ri(e,t,o,n,r),Z(e,o,q,i*a),bi(e,t,1.75-.95*a,.07/2,0,0)}function Hi(e,t,n,r,i,a,o){"worklet";let s=Math.min(1,.16*a*(1+1.5*o));zi(e,t,n,r,1.15,J,s),zi(e,t,n,r,.7,J,s),Bi(e,t,n,r,i,a,o),zi(e,t,n,r,.1,q,a*(.6+.4*o)),o>0&&Vi(e,t,n,r,a,o)}function Ui(e,t,n){"worklet";let r=n.satellites,i=0;for(let a=0;a<r.length&&i<ri;a++){let o=r[a],s=o===void 0?void 0:et(o,n.state.time);o!==void 0&&s!==void 0&&(Li(e,t,i,o.glyph),Hi(e,t,n,{centreX:.5+s.across*c,centreY:.5-s.up*c,glyphRadius:s.glyphRadii*c},i,s.light,o.flare),i++)}}function Wi(e,t,n){"worklet";e.enable(rn),e.blendEquation(un),e.blendFuncSeparate(1,769,1,771),e.enable(sn),e.stencilMask(255),e.enable(on),t.stencil[0]=0,e.activeTexture(Wt),e.bindTexture(L,t.sparkle),e.activeTexture(Wt+1),e.bindTexture(L,t.gradients),e.activeTexture(Wt),Si(e,t,n),Ti(e,t,n),Di(e,t,n),ki(e,t,n),ji(e,t,n),Ni(e,t,n),Ii(e,t,n),Ui(e,t,n),e.disable(sn),e.disable(on),e.depthMask(!0),e.bindVertexArray(null)}function Gi(e){"worklet";let t=Math.hypot(e[0],e[1],e[2]);return t<1e-6?null:[e[0]/t,e[1]/t,e[2]/t]}function Ki(e,t){"worklet";return[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]]}function qi(e,t){"worklet";return e[0]*t[0]+e[1]*t[1]+e[2]*t[2]}function Ji(e,t){"worklet";return Gi([t.x-e.x,0,t.z-e.z])??[0,0,1]}function Yi(e){"worklet";return{right:[e[2],0,-e[0]],up:[0,1,0],front:e}}function Xi(e,t,n){"worklet";let r=Gi([t.x-e.x,t.y-e.y,t.z-e.z]);if(r===null)return n??ut;let i=Gi([-r[1]*r[0],1-r[1]*r[1],-r[1]*r[2]]);return i===null?n??ut:{right:Ki(i,r),up:i,front:r}}function Zi(e,t){"worklet";let n=e=>[qi(e,t.right),qi(e,t.up),qi(e,t.front)];return{right:n(e.right),up:n(e.up),front:n(e.front)}}var Qi={blending:5,blendEquation:100,blendSrc:211,blendDst:203,blendEquationAlpha:100,blendSrcAlpha:213,blendDstAlpha:205};function $i(e,t){e.blendColor.setScalar(t),e.blendAlpha=t}var ea=.85,ta=`
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

in vec3 position;
in vec2 uv;

// Both the picture and the halo union were drawn into targets, bottom row first, so each is the
// right way up in the quad's own coordinates.
out vec2 targetCoordinate;

void main() {
  targetCoordinate = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,na=`
precision highp float;

uniform sampler2D picture;
uniform float alphaFromLight;

in vec2 targetCoordinate;

out vec4 colour;

${En}

void main() {
  // Raw encoded sRGB, exactly as the picture wrote it, premultiplied light over transparent black:
  // the projection layer is treated as sRGB and premultiplied, so blending these values matches
  // what the phone's Screen blend does.
  vec3 light = texture(picture, targetCoordinate).rgb;
  vec3 glow = haloGlow(targetCoordinate);
  light = light + glow - light * glow;
  colour = vec4(light, alphaFromLight * max(light.r, max(light.g, light.b)));
}
`;function ra(e,t){let n=new ge({glslVersion:he,vertexShader:ta,fragmentShader:na,uniforms:{picture:{value:t},halo:{value:null},haloShares:{value:new j},alphaFromLight:{value:ea}},transparent:!0,depthWrite:!1,premultipliedAlpha:!0,...Qi});$i(n,1);let r=new _e(new me(e,e),n);r.visible=!1;let i=[0,0,0];return{mesh:r,showHalo(e,t){let{uniforms:r}=n;r.halo.value=e,r.haloShares.value.fromArray(Dn(e===null?0:t,i))},setFade(e){$i(n,e)},dispose(){n.dispose(),r.geometry.dispose()}}}export{ot as A,Te as B,kt as C,P as D,Tt as E,We as F,He as G,ze as H,Ue as I,Ie as J,De as K,Ke as L,Ze as M,Ye as N,Ct as O,Je as P,qe as R,Nt as S,Ot as T,Re as U,we as V,Le as W,Pe as Y,Cn as _,Yi as a,F as b,Xi as c,Gn as d,er as f,wn as g,V as h,$i as i,Xe as j,wt as k,di as l,Rn as m,ra as n,Ji as o,Nn as p,ke as q,Qi as r,Zi as s,ea as t,Wi as u,Tn as v,Et as w,Pt as x,Ft as y,Ge as z};