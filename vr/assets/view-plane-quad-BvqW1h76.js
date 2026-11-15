import{$ as e,A as t,At as n,C as r,Ct as i,D as a,Dt as o,E as s,Et as c,F as l,H as u,I as d,J as f,K as p,L as m,M as h,N as g,O as _,Ot as v,P as y,Q as b,R as ee,S as x,St as S,T as C,Tt as w,U as te,V as T,W as E,X as D,Y as ne,Z as O,_ as k,_t as re,at as ie,b as ae,bt as A,ct as oe,et as j,gt as se,ht as M,it as ce,j as le,k as ue,kt as de,lt as fe,mt as pe,nt as me,pt as he,q as ge,rt as _e,st as ve,tt as ye,v as N,w as be,wt as xe,xt as Se,y as Ce,yt as we,z as Te}from"./room-session-BhxPqhD9.js";import{L as Ee,T as De,d as Oe,k as ke,y as Ae}from"./three-BdQlZwYR.js";var je=.6,Me=.9,Ne=.35,Pe=.4,Fe=.35,Ie=18*Math.PI/180,Le=`M 0.45 0 A 0.45 0.45 0 1 0 -0.45 0 A 0.45 0.45 0 1 0 0.45 0 Z`,Re={satellites:new Map,steppedAt:void 0,arrivals:0};function P(e){return e===`answered`||e===`failed`}function ze(e,t){switch(t.state){case`planned`:return e===void 0||P(e)?`planned`:e;case`tool`:case`working`:return`working`;default:return t.state}}function Be(e,t,n){let r=e.satellites.get(t.delegationId);if(r===void 0||P(r.status)&&t.state===`planned`)return Ve(e,t,n);if(P(r.status))return e;let i=ze(r.status,t),a=new Map(e.satellites);return a.set(t.delegationId,{...r,status:i,glyph:t.glyph??r.glyph,heardAt:n,toolAt:t.state===`tool`?n:r.toolAt,endedAt:P(i)?n:void 0}),{...e,satellites:a}}function Ve(e,t,n){let r=ze(void 0,t);if(P(r)||Ue(e)>=8)return e;let i=new Map(e.satellites);return i.set(t.delegationId,{agentId:t.agentId,glyph:t.glyph,status:r,heardAt:n,toolAt:t.state===`tool`?n:void 0,endedAt:void 0,presence:0,offset:We(e,e.arrivals),order:e.arrivals}),{...e,satellites:i,arrivals:e.arrivals+1}}function He(e,t){if(e.satellites.size===0)return e;let n=new Map;for(let[r,i]of e.satellites)n.set(r,P(i.status)?i:{...i,status:`answered`,endedAt:t});return{...e,satellites:n}}function Ue(e){let t=0;for(let n of e.satellites.values())P(n.status)||t++;return t}function We(e,t){let n=[...e.satellites.values()].filter(e=>!P(e.status)).map(e=>Ge(e.offset)).sort((e,t)=>e-t);if(n.length===0)return t===0?0:Ge(t*.38);let r={start:n[n.length-1]??0,size:1-(n[n.length-1]??0)+(n[0]??0)};for(let e=1;e<n.length;e++){let t=n[e-1]??0,i=(n[e]??0)-t;i>r.size&&(r={start:t,size:i})}return Ge(r.start+r.size/2)}function Ge(e){return e-Math.floor(e)}function Ke(e,t){return Ge(t-e+.5)-.5}function qe(e,t){let n=e.steppedAt===void 0?0:Math.max(0,t-e.steppedAt),r=[...e.satellites.entries()].filter(([,e])=>!P(e.status)).sort(([,e],[,t])=>e.order-t.order),i=r[0]?.[1].offset??0,a=new Map(r.map(([e],t)=>[e,Ge(i+t/r.length)])),o=new Map;for(let[r,i]of e.satellites){let e=!P(i.status)&&i.status!==`asking`&&t-i.heardAt>90?{...i,status:`failed`,endedAt:t}:i;if(e.endedAt!==void 0&&t-e.endedAt>=.9)continue;let s=a.get(r),c=1-Math.exp(-3*n);o.set(r,{...e,presence:Math.min(1,e.presence+n/Ne),offset:s===void 0?e.offset:Ge(e.offset+Ke(e.offset,s)*c)})}return{...e,satellites:o,steppedAt:t}}function Je(e){let t=Math.min(1,Math.max(0,e));return t*t*(3-2*t)}function Ye(e,t){return[...e.satellites.values()].sort((e,t)=>e.order-t.order).map(e=>{let n=e.endedAt===void 0?0:Je((t-e.endedAt)/Me),r=e.status===`failed`,i=e.status===`planned`?Pe:1,a=e.toolAt===void 0?0:Math.max(0,1-(t-e.toolAt)/je);return{glyph:e.glyph??`M 0.45 0 A 0.45 0.45 0 1 0 -0.45 0 A 0.45 0.45 0 1 0 0.45 0 Z`,level:Je(e.presence)*i*(1-n*(r?1:.6)),flare:a*a,asking:e.status===`asking`,turn:e.offset,reach:r?1+Fe*n:1-n}})}function Xe(e,t){"worklet";let n=2*Math.PI*(t/9+e.turn),r=Math.sin(n)*e.reach;return{across:Math.cos(n)*e.reach,up:-r*Math.sin(Ie),towards:r*Math.cos(Ie)}}function Ze(e){return[...e.satellites.values()].sort((e,t)=>e.order-t.order).map(({agentId:e,status:t})=>({agentId:e,status:t}))}var Qe=[{agentId:`sampleDiamond`,glyph:`M 0 -0.7 L 0.7 0 L 0 0.7 L -0.7 0 Z`},{agentId:`sampleSquare`,glyph:`M -0.55 -0.55 L 0.55 -0.55 L 0.55 0.55 L -0.55 0.55 Z`},{agentId:`sampleCross`,glyph:`M -0.65 0 L 0.65 0 M 0 -0.65 L 0 0.65`}],$e=1.4,et=e=>`sample-${e}`;function tt(e,t,n){let r=e,i=Math.floor(n/$e);return Qe.forEach(({agentId:e,glyph:a},o)=>{let s=et(e),c=r.satellites.get(s),l=c!==void 0&&!P(c.status);if(!t){l&&(r=Be(r,{delegationId:s,agentId:e,glyph:a,state:`answered`},n));return}l||(r=Be(r,{delegationId:s,agentId:e,glyph:a,state:`working`},n));let u=r.satellites.get(s)?.toolAt,d=u!==void 0&&Math.floor(u/1.4)===i;i%Qe.length===o&&!d&&(r=Be(r,{delegationId:s,agentId:e,glyph:a,state:`tool`},n))}),r}var nt=1.22,rt=.13,it=1.6,at=.15,ot=.8,st=.45;function ct(e,t){"worklet";if(e.level<=0)return;let{across:n,up:r,towards:i}=Xe(e,t),a=.5+.5*Math.max(-1,Math.min(1,i)),o=.5+.5*Math.cos(2*Math.PI*t/it);return{across:n*nt,up:r*nt,glyphRadii:rt*(ot+.19999999999999996*a),light:e.level*(st+.55*a)*(e.asking?.55+.45*o:1)}}function lt(e){return e-Math.floor(e)}var ut=13.7,dt=3.91,ft=7.7113,pt=9.7;function mt(e){let t=e.body.length/9,n=e.stream.length/10,r=t+n,i={count:r,bodyCount:t,streamCount:n,rest:new Float32Array(r*4),shape:new Float32Array(r*4),hashes:new Float32Array(r*4),identity:new Float32Array(r*3),thinning:new Float32Array(r)};for(let n=0;n<t;n++)ht(i,n,e.body,n*9);for(let r=0;r<n;r++)gt(i,t+r,e.stream,r*10);return i}function ht(e,t,n,r){let{rest:i,shape:a,hashes:o,identity:s}=e,c=n[r+6],l=t*4;i[l]=n[r],i[l+1]=n[r+1],i[l+2]=n[r+8],i[l+3]=0,a[l]=n[r+2],a[l+1]=n[r+3],a[l+2]=n[r+4],a[l+3]=n[r+5],o[l]=lt(c*h),_t(o,l,c),s[t*3]=lt(c*pt),s[t*3+1]=c,s[t*3+2]=n[r+7],e.thinning[t]=he(c)}function gt(e,t,n,r){let{rest:i,shape:a,hashes:o,identity:s}=e,c=n[r+7],l=t*4;i[l]=n[r],i[l+1]=n[r+1],i[l+2]=n[r+2],i[l+3]=1,a[l]=n[r+3],a[l+1]=n[r+4],a[l+2]=0,a[l+3]=n[r+5],o[l]=n[r+6],_t(o,l,c),s[t*3]=0,s[t*3+1]=c,s[t*3+2]=n[r+8]+24*n[r+9],e.thinning[t]=he(c)}function _t(e,t,n){e[t+1]=lt(n*ut),e[t+2]=lt(n*dt),e[t+3]=lt(n*ft)}var vt={right:[1,0,0],up:[0,1,0],front:[0,0,1]};function yt(e){return e>0?e>1?1:e:0}function bt(e){let t=e<0?0:e>1?1:e;return t*t*(3-2*t)}function xt(e){return e-Math.floor(e)}function F(e,t){return e[0]*t[0]+e[1]*t[1]+e[2]*t[2]}function St(e,t,n,r){if(r.swirl>=1)return 1;let i=yt(.9*Math.sqrt(e*e+t*t)+.1*xt(n*3.91));return .04+.96*bt((r.swirl-.6*i)/.4)}var Ct=.816;function wt(e,t){return Number.isFinite(t)?t/Math.max(t-e,.1*t):1}function Tt(e,t,n,r,i,a){let o=i.hearing*m;if(o<=.001)return[e,t,n,0];let s=wt(n,a),c=i.listened;re(e*s,t*s,r,i,c);let l=M(i)*Ct,u=Math.floor(n/l+.5)*l,d=1/wt(u,a);return[e+(c[0]*d-e)*o,t+(c[1]*d-t)*o,n+(u-n)*o,c[2]??0]}function Et(e,t,n,r,i,a){let o=e-n,s=t-r;return[n+o*i-s*a,r+o*a+s*i]}function Dt(e,t,n,r){let{right:i,up:a,front:o}=e;return[t*i[0]-n*a[0]+r*o[0],t*i[1]-n*a[1]+r*o[1],t*i[2]-n*a[2]+r*o[2]]}function Ot(e,t,r){let{x:i,y:o,axisX:s,axisY:c}=e,l=[i,o];if(t.voiceWaveLargest>0&&e.group!==3){de(i,o,t),n(s,c,i,o,t.waved[2]??0,e.alongWave,t);let r=t.waved;i=r[0]??i,o=r[1]??o,s=r[3]??s,c=r[4]??c}let u=-c*.55,d=s*.55;if(e.group>0){let n=v(e.group,e.fromCore,t)*Math.PI/180,r=Math.cos(n),l=Math.sin(n),f=e.group!==3;[i,o]=Et(i,o,f?a:0,f?_:0,r,l),[s,c]=[s*r-c*l,s*l+c*r],[u,d]=[u*r-d*l,u*l+d*r]}return{centre:Dt(r,i,o,e.depth),axis:Dt(r,s,c,e.axisDepth),normal:Dt(r,u,d,0),tier:e.tier,light:e.light,glyph:e.glyph,group:e.group,plane:l}}function kt(e,t,n,r,i,a){if(r>0)return[e,t,n];let o=[e*i.bodyCos+n*i.bodySin,-t,n*i.bodyCos-e*i.bodySin];return[F(o,a.right),-F(o,a.up),F(o,a.front)]}function At(e,t){return e?1:1+(t.scanBright[1]??0)}function jt(e,t,n,r,s=1/0){let l=n.reading,u=we(e,t,n,l);if(u<=0)return null;let[d=0,f=0,p=0,m=0]=[l[1],l[2],l[3],l[4]],h=e[t],v=e[t+1],y=e[t+4],b=e[t+6],ee=e[t+8],x=xt(p*.618034+b*9.7),[C,w,te]=kt(h,v,ee,f,n,r),T=[0,0];Se(C,w,e[t+2],e[t+3],T,0);let E=o(x,f,n),[D=0,ne=0]=T,O=D*Math.cos(E)-ne*Math.sin(E),k=D*Math.sin(E)+ne*Math.cos(E),re=f===2?0:yt((.76-(C*C+w*w))*3.2),ie=xt(x*23.17)-.5,ae=(x-.5)*1.4*y+ie*1.3*n.agitation*re,A=f===3,oe=A?0:ie*g,j=w+k*ae+O*oe,M=C+O*ae-k*oe,ce=A?1:yt((.94*.94-M*M-j*j)*8),le=i(M,j,h*h+v*v+ee*ee),ue=A?le*(1-me*n.thinking):le,de=u*ce;if(de<.1)return null;c(M,j,O,k,b,n);let[fe=0,he=0,ge=0,_e=0,ve=0]=n.swirled;if(ve<=0)return null;let ye=te*St(M,j,b,n),[N,be,xe,Te]=A?[fe,he,ye,0]:Tt(fe,he,ye,b,n,s),Ee=Dt(r,N,be,xe),De=A?de:de*S(Ee[0],-Ee[1],x,n);if(De<.1)return null;let Oe=te>=-Ce,ke=!A&&n.scanBright[0]>0&&Oe,Ae=At(A,n),je=Oe?pe(m,De*ue,b,n.hotShare):0,Me=y*.5*De*ve*se(n.hearing,Te)*Ae;return Ot({x:N,y:be,depth:xe,axisX:ge*Me,axisY:_e*Me,axisDepth:0,tier:ke?2:je,light:ke?1:ue,glyph:d,group:f,fromCore:Math.hypot(h-a,v-_),alongWave:f===2?0:1},n,r)}function Mt(e,t,n,r,i=1/0){let a=A(e,t,n);if(a<=0)return null;let o=n.reading[0],s=e[t],l=e[t+1],u=e[t+2],d=e[t+3],f=e[t+4],p=e[t+7],m=[s*n.streamCos+u*n.streamSin,-l,u*n.streamCos-s*n.streamSin],h=F(m,r.right),g=-F(m,r.up),_=F(m,r.front),v=a*yt((.86-h*h-g*g)*8);if(v<.1)return null;let y=[d*n.streamCos+f*n.streamSin,0,f*n.streamCos-d*n.streamSin],b=_<-.2?0:pe(e[t+8]-3*o,v,p,n.hotShare);c(h,g,1,0,p,n);let[ee=0,x=0,S=0,C=0,w=0]=n.swirled;if(w<=0)return null;let[te,T,E,D]=Tt(ee,x,_*St(h,g,p,n),p,n,i),ne=F(y,r.right)<0?-1:1,O=ne*F(y,r.right),k=-ne*F(y,r.up),re=ne*F(y,r.front),ie=v*w*se(n.hearing,D);return Ot({x:te,y:T,depth:E,axisX:(O*S-k*C)*ie,axisY:(O*C+k*S)*ie,axisDepth:re*ie,tier:b,light:1,glyph:e[t+9],group:0,fromCore:0,alongWave:0},n,r)}function I(e){let t=String(e);return/[.e]/.test(t)?t:`${t}.0`}function Nt(e){let t=t=>I((e>>t&255)/255);return`vec3(${t(16)}, ${t(8)}, ${t(0)})`}function Pt(){return{time:{value:0},mixShare:{value:0},hotShare:{value:1},agitation:{value:0},swirl:{value:1},hearing:{value:0},thinking:{value:0},scanHeight:{value:0},scanTilt:{value:[1,0]},density:{value:1},bodyTurn:{value:[1,0]},streamTurn:{value:[1,0]},shellTurn:{value:[1,0]},gyroSway:{value:[1,0]},rimTurn:{value:[1,0]},lattice:{value:[1,0,.11,0]},viewRight:{value:[1,0,0]},viewUp:{value:[0,1,0]},viewFront:{value:[0,0,1]},eyeDistance:{value:Ft},voiceWave0:{value:[0,0,0,0]},voiceWave1:{value:[0,0,0,0]},voiceWave2:{value:[0,0,0,0]},voiceWave3:{value:[0,0,0,0]},voiceWaveClock:{value:[0,0]},heardWave0:{value:[0,0,0,0]},heardWave1:{value:[0,0,0,0]},heardWave2:{value:[0,0,0,0]},heardWave3:{value:[0,0,0,0]},heardWaveClock:{value:[0,0]}}}var Ft=1e5;function L(e,t){"worklet";return[e[t]??0,e[t+1]??0,e[t+2]??0,e[t+3]??0]}function It(e,t,n,r,i){"worklet";e.time.value=t.time,e.mixShare.value=t.mix,e.hotShare.value=t.hotShare,e.agitation.value=t.agitation,e.swirl.value=t.swirl,e.hearing.value=t.hearing,e.thinking.value=t.thinking,e.scanHeight.value=t.scan,e.scanTilt.value=[t.scanTiltCos,t.scanTiltSin],e.density.value=r,e.bodyTurn.value=[t.bodyCos,t.bodySin],e.streamTurn.value=[t.streamCos,t.streamSin];let a=t.shellTurn*Math.PI/180;e.shellTurn.value=[Math.cos(a),Math.sin(a)];let o=t.gyroSway*Math.PI/180;e.gyroSway.value=[Math.cos(o),Math.sin(o)];let s=t.rimRoll*Math.PI/180;e.rimTurn.value=[Math.cos(s),Math.sin(s)];let c=t.time*Te;e.lattice.value=[Math.cos(c),Math.sin(c),M(t),t.hearing*m],e.viewRight.value=n.right,e.viewUp.value=n.up,e.viewFront.value=n.front,e.eyeDistance.value=Number.isFinite(i)?i:Ft,e.voiceWave0.value=L(t.voiceWave,0),e.voiceWave1.value=L(t.voiceWave,4),e.voiceWave2.value=L(t.voiceWave,8),e.voiceWave3.value=L(t.voiceWave,12),e.voiceWaveClock.value=[t.voiceWaveLargest,t.voiceWavePhase],e.heardWave0.value=L(t.heardWave,0),e.heardWave1.value=L(t.heardWave,4),e.heardWave2.value=L(t.heardWave,8),e.heardWave3.value=L(t.heardWave,12),e.heardWaveClock.value=[t.heardWaveLargest,t.heardWavePhase]}var Lt=`
uniform float time;
uniform float mixShare;
uniform float hotShare;
uniform float agitation;
uniform float swirl;
uniform float hearing;
uniform float thinking;
uniform float scanHeight;
uniform vec2 scanTilt;
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
// The rings his syllables send out of his core, in R, newest first, four to a vector; and the
// strongest of them (0 while he is silent) with how far the newest has travelled, in slots.
uniform vec4 voiceWave0;
uniform vec4 voiceWave1;
uniform vec4 voiceWave2;
uniform vec4 voiceWave3;
uniform vec2 voiceWaveClock;
// Their syllables' rings flowing in through the lattice, as his are kept.
uniform vec4 heardWave0;
uniform vec4 heardWave1;
uniform vec4 heardWave2;
uniform vec4 heardWave3;
uniform vec2 heardWaveClock;

// One row of body-rows.ts.
in vec4 rest;
in vec4 shape;
in vec4 hashes;
in vec3 identity;
in float thinning;

const float DUTY = ${I(t)};
const float FAINTEST = ${I(le)};
const float WANDER = ${I(g)};
const float SCAN_SOFTNESS = ${I(p)};
const float SCAN_FLOOR = ${I(te)};
const float SCAN_STRETCH = ${I(ge)};
const float SCAN_PROMOTED_SHARE = ${I(E)};
const float SCAN_DEAL_FROM_HOP = ${I(u)};
const float SHELL_FACE_DIMMING = ${I(f)};
const float BACK_OF_THE_SHELL = ${I(Ce)};
const float STROKE_SHRINK = ${I(ee)};
const float VORTEX_TWIST = ${I(fe)};
const float VORTEX_STRETCH = ${I(4)};
const float LAYER_SHARE = ${I(Ct)};
const vec2 CORE = vec2(${I(a)}, ${I(_)});
const int GLYPH_STEP = 24;
const int GROUP_STEP = 6;
const int INNER_LAYER_GROUP = 1;
const int GYRO_GROUP = 2;
const int TRUSS_GROUP = 3;
const float GIMBAL_SPLIT = ${I(y)};
const float THOUGHT_SCATTER = ${I(e)};
const float THOUGHT_FROM_HOP = ${I(b)};
const float TRUSS_THINKING_DIM = ${I(me)};
const float VOICE_WAVE_FROM = ${I(_e)};
const float VOICE_WAVE_GONE = ${I(ie)};
const float VOICE_WAVE_TAPER = ${I(oe)};
const float VOICE_WAVE_STEP = ${I(ve)};
const float VOICE_WAVE_FULL_CROWDING = ${I(ce)};
const float VOICE_WAVE_ALONG = ${I(1)};
const float HEARD_WAVE_FROM = ${I(l)};
const float HEARD_WAVE_GONE = ${I(d)};

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

// voiceWaveKernel and its slope at four offsets at once: the quadratic B-spline the rings are drawn
// through. step(apart, 0.5) is 1 inside half a slot, as voiceWaveKernel's "apart < 0.5" is; the two
// pieces meet there, so the edge itself does not matter.
vec4 voiceWaveKernel(vec4 offset) {
  vec4 apart = abs(offset);
  vec4 outside = max(1.5 - apart, 0.0);
  return mix(0.5 * outside * outside, 0.75 - apart * apart, step(apart, vec4(0.5)));
}

vec4 voiceWaveKernelSlope(vec4 offset) {
  vec4 apart = abs(offset);
  vec4 outside = max(1.5 - apart, 0.0);
  return mix(-sign(offset) * outside, -2.0 * offset, step(apart, vec4(0.5)));
}

// voiceWaveSum and voiceWaveSumSlope of a train of rings, four knots to a vector, at slots, together.
vec2 ringsAt(float slots, vec4 knots0, vec4 knots1, vec4 knots2, vec4 knots3) {
  vec4 offset = vec4(slots) - vec4(0.0, 1.0, 2.0, 3.0);
  vec2 wave = vec2(dot(knots0, voiceWaveKernel(offset)), dot(knots0, voiceWaveKernelSlope(offset)));
  offset -= 4.0;
  wave += vec2(dot(knots1, voiceWaveKernel(offset)), dot(knots1, voiceWaveKernelSlope(offset)));
  offset -= 4.0;
  wave += vec2(dot(knots2, voiceWaveKernel(offset)), dot(knots2, voiceWaveKernelSlope(offset)));
  offset -= 4.0;
  wave += vec2(dot(knots3, voiceWaveKernel(offset)), dot(knots3, voiceWaveKernelSlope(offset)));
  return wave;
}

float smooth01Slope(float value) {
  return value > 0.0 && value < 1.0 ? 6.0 * value * (1.0 - value) : 0.0;
}

// Where a train of rings pushes a point, and how crowded the points are there: out from the core
// for rings born nearer it than they melt, in toward it for the rest. pushAlongRings.
vec3 pushAlongRings(
  vec2 point,
  vec4 knots0,
  vec4 knots1,
  vec4 knots2,
  vec4 knots3,
  float phase,
  float from,
  float gone
) {
  vec2 fromCore = point - CORE;
  float reach = length(fromCore);
  float outward = gone > from ? 1.0 : -1.0;
  float travelled = outward * (reach - from);
  float left = outward * (gone - reach);
  if (travelled <= 0.0 || left <= 0.0) return vec3(point, 0.0);
  vec2 wave = ringsAt(travelled / VOICE_WAVE_STEP - phase, knots0, knots1, knots2, knots3);
  float comingIn = travelled / VOICE_WAVE_TAPER;
  float goingOut = left / VOICE_WAVE_TAPER;
  float taperIn = smooth01(comingIn);
  float taperOut = smooth01(goingOut);
  float taper = taperIn * taperOut;
  float taperSlope = (smooth01Slope(comingIn) * taperOut - taperIn * smooth01Slope(goingOut)) / VOICE_WAVE_TAPER;
  vec2 pushed = CORE + fromCore * ((reach + outward * taper * wave.x) / reach);
  return vec3(pushed, -(taperSlope * wave.x + taper * wave.y / VOICE_WAVE_STEP));
}

// Where his syllables' rings push a speck seen at point, and how crowded the specks are there:
// voiceWavePush.
vec3 voiceWavePush(vec2 point) {
  return pushAlongRings(
    point,
    voiceWave0,
    voiceWave1,
    voiceWave2,
    voiceWave3,
    voiceWaveClock.y,
    VOICE_WAVE_FROM,
    VOICE_WAVE_GONE
  );
}

// The lattice point for where the centre eye sees the fragment, the depth pulled as far into the
// nearest layer, and the fragment put where the eye sees it on that point from its layer; and how
// crowded their rings make its knot, which gives a speck back its length (latticeStrokeShare).
vec3 onLattice(vec2 point, float depth, float jitterHash, out float crowding) {
  crowding = 0.0;
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
  // Pulled in toward the core by their syllables' rings flowing in through it: latticeTarget.
  if (heardWaveClock.x > 0.0) {
    vec3 pulled = pushAlongRings(
      target,
      heardWave0,
      heardWave1,
      heardWave2,
      heardWave3,
      heardWaveClock.y,
      HEARD_WAVE_FROM,
      HEARD_WAVE_GONE
    );
    target = pulled.xy;
    crowding = pulled.z;
  }
  float layer = spacing * LAYER_SHARE;
  float snappedDepth = roundHalfUp(depth / layer) * layer;
  vec2 placed = target / seenLarger(snappedDepth);
  return vec3(point + (placed - point) * pull, depth + (snappedDepth - depth) * pull);
}

// How much of its length a speck keeps on the lattice: latticeStrokeShare.
float latticeStrokeShare(float crowding) {
  return 1.0 - STROKE_SHRINK * hearing * (1.0 - clamp01(crowding / VOICE_WAVE_FULL_CROWDING));
}

// What the thinking band leaves of a fragment's light, at (across, down) in the body's own frame:
// whether it promotes it, by a chance dealt from its hop, and how much longer it draws it. scanned.
float scanned(vec2 bodyPoint, float hop, out bool bright, out float stretch) {
  if (thinking <= 0.0) {
    bright = false;
    stretch = 0.0;
    return 1.0;
  }
  float height = bodyPoint.y * scanTilt.x + bodyPoint.x * scanTilt.y;
  float apart = (height - scanHeight) / SCAN_SOFTNESS;
  float nearness = exp(-apart * apart);
  bright = fract(hop * SCAN_DEAL_FROM_HOP) < SCAN_PROMOTED_SHARE * thinking * nearness * nearness;
  stretch = SCAN_STRETCH * thinking * nearness;
  return 1.0 - thinking * (1.0 - SCAN_FLOOR) * (1.0 - nearness);
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

// A speck's stroke where a ring crowds the specks together, lying more along the ring and no
// longer: voiceWaveTurn.
vec2 voiceWaveTurn(vec2 axis, vec2 point, float crowding, float along) {
  if (along <= 0.0 || crowding <= 0.0) return axis;
  vec2 fromCore = point - CORE;
  float reach = length(fromCore);
  if (reach <= 0.0) return axis;
  vec2 outward = fromCore / reach;
  float bend = along * clamp01(crowding / VOICE_WAVE_FULL_CROWDING);
  vec2 turned = axis - bend * dot(axis, outward) * outward;
  float turnedLength = length(turned);
  if (turnedLength <= 0.0) return axis;
  return turned * (length(axis) / turnedLength);
}

// The last step every fragment shares: pushed out by the rings his syllables send out of his core,
// all but the truss's; its group's turn in the view plane — about his middle for the truss, about
// the core for the rest; then out of the plane into the body's frame. plane is where it was before
// the push, so the sparkle read there rides with the speck.
Fragment finishFragment(
  vec3 placed,
  vec2 axis,
  float axisDepth,
  float tier,
  float light,
  float glyph,
  int group,
  float fromCore,
  float alongWave
) {
  Fragment fragment = hiddenFragment();
  fragment.visible = true;
  fragment.plane = placed.xy;
  fragment.planeAxis = axis;
  vec2 point = placed.xy;
  if (voiceWaveClock.x > 0.0 && group != TRUSS_GROUP) {
    vec3 waved = voiceWavePush(point);
    axis = voiceWaveTurn(axis, point, waved.z, alongWave);
    point = waved.xy;
  }
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
  float scanStretch = 0.0;
  float crowding = 0.0;
  float litHere = lit;
  if (!truss) {
    placed = onLattice(swirled.xy, depth * scale, hashes.w, crowding);
    vec3 body = intoBody(placed.xy, placed.z);
    litHere = lit * scanned(vec2(body.x, -body.y), hop, scanBright, scanStretch);
  }
  if (litHere < FAINTEST) return hiddenFragment();
  bool facing = depth >= -BACK_OF_THE_SHELL;
  bool promoted = scanBright && facing;
  float plain = facing ? fragmentTier(brightness, litHere * light, hashes.y) : 0.0;
  float tier = promoted ? 2.0 : plain;
  float halfLength = fragmentLength * 0.5 * litHere * drawn * latticeStrokeShare(crowding) * (1.0 + scanStretch);
  return finishFragment(
    placed,
    swirled.zw * halfLength,
    0.0,
    tier,
    promoted ? 1.0 : light,
    float(glyph),
    group,
    length(rest.xy - CORE),
    // The gyroscope's arcs keep their way as a ring passes through them: they rock instead.
    group == GYRO_GROUP ? 0.0 : VOICE_WAVE_ALONG
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
  float crowding;
  vec3 placed = onLattice(swirled.xy, depth * scale, hashes.w, crowding);
  float rightwards = dot(tangent, viewRight) < 0.0 ? -1.0 : 1.0;
  vec2 tangentPlane = rightwards * vec2(dot(tangent, viewRight), -dot(tangent, viewUp));
  float tangentDepth = rightwards * dot(tangent, viewFront);
  float size = lit * drawn * latticeStrokeShare(crowding);
  vec2 direction = swirled.zw;
  vec2 axis = vec2(
    tangentPlane.x * direction.x - tangentPlane.y * direction.y,
    tangentPlane.x * direction.y + tangentPlane.y * direction.x
  ) * size;
  // The stream's strokes keep their way: they are tangents of their latitude.
  return finishFragment(placed, axis, tangentDepth * size, tier, 1.0, float(glyph), 0, 0.0, 0.0);
}

Fragment readFragment() {
  // A share keeps the rows whose key is under it. The index is in key order, so the phone's and the
  // watch's renderer draw only those (quadsKept); this hides the rest for a draw of every row.
  if (thinning >= density) return hiddenFragment();
  // An if rather than ?:, which WebGL does not allow on structures.
  if (rest.w < 0.5) return readBodyFragment();
  return readStreamFragment();
}
`,Rt=`
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
`,zt=64*D;function Bt(e){return xe(e.textureSeed^ne)}var R={dim:{colour:12342822,width:.014,alpha:.6},mid:{colour:15492644,width:.0155,alpha:.88},bright:{colour:16748096,width:.0155,alpha:1},hot:{colour:16758924,width:.007,alpha:.9}},Vt=1.2,Ht=`
precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
// The height of the viewport being drawn, in pixels, and how many metres the drawing's unit is.
uniform float viewportHeight;
uniform float unitMetres;

in vec2 corner;

${Lt}
${Rt}

// Where this corner is in the glyph's own frame — along it, across it — in the drawing's unit.
out vec2 local;
// Where it is in the view plane before the inner layer's turn, which is where the sparkle is read.
out vec2 sparklePoint;
// The glyph, its half-length, its normal's length and its tier.
flat out vec4 glyphShape;
// How much of its tier's paint it shows.
flat out float shellLight;

const float WIDEST_HALF_STROKE = ${I(R.bright.width/2)};
const float THINNEST_PIXELS = ${I(Vt)};

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
`,Ut=`
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

${Rt}

const vec3 DIM = ${Nt(R.dim.colour)};
const vec3 MID = ${Nt(R.mid.colour)};
const vec3 BRIGHT = ${Nt(R.bright.colour)};
const vec3 HOT = ${Nt(R.hot.colour)};
const float THINNEST_PIXELS = ${I(Vt)};
const float SPARKLE_REPEAT = ${I(zt)};

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
  float halfWidth = ${I(R.dim.width/2)};
  float strength = ${I(R.dim.alpha)};
  if (tier > 1.5) {
    paint = BRIGHT * sparkleLevel;
    halfWidth = ${I(R.bright.width/2)};
    strength = 1.0 - 0.25 * agitation;
  } else if (tier > 0.5) {
    paint = MID * sparkleLevel;
    halfWidth = ${I(R.mid.width/2)};
    strength = ${I(R.mid.alpha)};
  }
  float drawnHalf = max(halfWidth, 0.5 * THINNEST_PIXELS * pixel);
  strength *= halfWidth / drawnHalf;
  vec3 light = paint * strength * coverage(glyphStrokeDistance(local, glyph, halfLength, normalLength, drawnHalf), pixel);

  if (tier > 1.5) {
    float hotHalf = ${I(R.hot.width/2)};
    float drawnHot = max(hotHalf, 0.5 * THINNEST_PIXELS * pixel);
    float hotStrength = ${I(R.hot.alpha)} * (1.0 - 0.95 * agitation) * hotHalf / drawnHot;
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
`,Wt=35633,Gt=35632,z=34962,Kt=34963,qt=35044,Jt=5126,Yt=5121,Xt=5123,Zt=5125,B=3553,Qt=33984,$t=6408,en=32856,tn=10240,nn=10241,rn=10242,an=10243,on=9729,sn=10497,cn=33071,V=36160,ln=36064,un=36053,dn=16384,fn=3042,pn=2884,mn=2929,hn=2960,gn=3089,_n=3024,vn=32774,yn=32776,bn=32769,xn=32771,Sn=35048,Cn=1024,wn=7680,Tn=7681;function H(e){return`id`in e&&typeof e.id==`number`?{id:e.id}:e}function En(e,t,n){let r=e.createShader(t);if(r===null)throw Error(`The hologram's GPU passes could not make a shader.`);if(e.shaderSource(r,`#version 300 es\n${n}`),e.compileShader(r),e.getShaderParameter(r,35713)!==!0){let t=e.getShaderInfoLog(r);throw e.deleteShader(r),Error(`The hologram's GPU shader did not compile: ${t}`)}return r}function Dn(e,t,n,r){let i=e.createProgram();if(i===null)throw Error(`The hologram's GPU passes could not make a program.`);let a=En(e,Wt,t),o=En(e,Gt,n);if(e.attachShader(i,a),e.attachShader(i,o),e.linkProgram(i),e.deleteShader(a),e.deleteShader(o),e.getProgramParameter(i,35714)!==!0){let t=e.getProgramInfoLog(i);throw e.deleteProgram(i),Error(`The hologram's GPU program did not link: ${t}`)}let s={};for(let t of r){let n=e.getUniformLocation(i,t);s[t]=n===null?null:H(n)}return{program:H(i),uniforms:s}}function U(e,t,n){let r=e.createBuffer();if(r===null)throw Error(`The hologram's GPU passes could not make a buffer.`);return e.bindBuffer(t,r),e.bufferData(t,n,qt),r}function On(e,t,n,r){let i=e.createVertexArray();if(i===null)throw Error(`The hologram's GPU passes could not make a vertex array.`);e.bindVertexArray(i);for(let[r,i,a]of n){let n=e.getAttribLocation(t,r);n<0||(e.bindBuffer(z,i),e.enableVertexAttribArray(n),e.vertexAttribPointer(n,a,Jt,!1,0,0))}return e.bindBuffer(Kt,r),e.bindVertexArray(null),i}function kn(e,t){let n=e.createTexture();if(n===null)throw Error(`The hologram's GPU passes could not make a texture.`);return e.bindTexture(B,n),e.texParameteri(B,nn,on),e.texParameteri(B,tn,on),e.texParameteri(B,rn,t),e.texParameteri(B,an,t),n}var W={colour:13653532,dim:{width:.11,strength:.18},mid:{width:.12,strength:.24},bright:{width:.16,strength:.65}},An=2,jn=`
precision highp float;
precision highp int;

// One texel, in the drawing's unit, and his radius as a share of the square the target covers.
uniform float texelUnits;
uniform float radiusFraction;

in vec2 corner;

${Lt}
${Rt}

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
  float width = fragment.tier > 1.5 ? ${I(W.bright.width)} : (fragment.tier > 0.5 ? ${I(W.mid.width)} : ${I(W.dim.width)});
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
`,Mn=`
precision highp float;
precision highp int;

in vec2 local;
flat in vec4 glyphShape;
flat in float haloRadius;
flat in float shellLight;

out vec4 colour;

${Rt}

void main() {
  float reached = glyphLineDistance(local, glyphShape.x, glyphShape.y, glyphShape.z) / haloRadius;
  if (reached >= 1.0) discard;
  float covered = pow(1.0 - reached, ${I(An)}) * shellLight;
  float tier = glyphShape.w;
  colour = vec4(tier < 0.5 ? covered : 0.0, tier > 0.5 && tier < 1.5 ? covered : 0.0, tier > 1.5 ? covered : 0.0, 0.0);
}
`;function Nn(e,t,n=512){"worklet";return t.radiusFraction=e,t.texelUnits=1/(e*n),t}var Pn=`
uniform sampler2D halo;
// The halo tiers' strengths (dim, mid, bright) times the voice's glow; all 0 with no halo pass.
uniform vec3 haloShares;

const vec3 HALO = ${Nt(W.colour)};

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
`;function Fn(e,t){"worklet";return t[0]=W.dim.strength*e,t[1]=W.mid.strength*e,t[2]=W.bright.strength*e,t}var In=`
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
`,Ln=`
precision highp float;

uniform float alphaFromLight;

in vec2 haloCoordinate;

out vec4 colour;

${Pn}

void main() {
  vec3 glow = haloGlow(haloCoordinate);
  colour = vec4(glow, alphaFromLight * max(glow.r, max(glow.g, glow.b)));
}
`,Rn=[-1,-1,1,-1,1,1,-1,1],zn=[0,1,2,0,2,3],Bn=65535,Vn=[[`rest`,4],[`shape`,4],[`hashes`,4],[`identity`,3],[`thinning`,1]];function Hn(e,t){"worklet";let n=Math.fround(t),r=0,i=e.length;for(;r<i;){let t=r+i>>>1;e[t]<n?r=t+1:i=t}return r}function Un(e,t){let n=e.length/t,r=new Float32Array(e.length*4);r.set(e);for(let e=n-1;e>=0;e--){let n=e*t,i=n*4;r.copyWithin(i,n,n+t),r.copyWithin(i+t,i,i+t),r.copyWithin(i+2*t,i,i+2*t)}return r}function Wn(e){let t=new Float32Array(e*Rn.length);if(e===0)return t;t.set(Rn);for(let e=Rn.length;e<t.length;e*=2)t.copyWithin(e,0,e);return t}function Gn(e){let t=e.slice().sort(),n=new Map;for(let e=t.length-1;e>=0;e--)n.set(t[e],e);let r=new Uint32Array(e.length);for(let t=0;t<e.length;t++){let i=e[t],a=n.get(i);if(a===void 0)throw Error(`row ${t}'s density key ${i} is not among the sorted keys`);r[t]=a,n.set(i,a+1)}return r}function Kn(e){let t=Vn.map(([t,n])=>({name:t,size:n,values:Un(e[t],n)})),n=Wn(e.count),r=e.count*4,i=e.count*zn.length,a=r<=Bn?new Uint16Array(i):new Uint32Array(i),{thinning:o}=e,s=Gn(o),c=new Float32Array(e.count);for(let t=0;t<e.count;t++){let e=s[t];c[e]=o[t];let n=e*zn.length,r=t*4;for(let e=0;e<zn.length;e++)a[n+e]=r+zn[e]}return{vertexCount:r,attributes:t,corner:n,index:a,keys:c}}var qn=new Float32Array([-1,1,1,1,-1,-1,1,-1]),Jn=new Uint16Array([0,2,1,2,3,1]),Yn=Object.keys(Pt()),Xn=[...Yn,`texelUnits`,`radiusFraction`],Zn=[...Yn,`modelViewMatrix`,`projectionMatrix`,`viewportHeight`,`unitMetres`,`sparkle`,`alphaFromLight`],Qn=[`modelViewMatrix`,`projectionMatrix`,`viewRight`,`viewUp`,`halfSide`,`halo`,`haloShares`,`alphaFromLight`];function $n(e,t,n={}){let r=n.haloTexels??512,i=mt(t),a=Kn(i),o=Dn(e,jn,Mn,Xn),s=Dn(e,Ht,Ut,Zn),c=Dn(e,In,Ln,Qn),l=a.attributes.map(({name:t,size:n,values:r})=>[t,U(e,z,r),n]);l.push([`corner`,U(e,z,a.corner),2]);let u=U(e,Kt,a.index),d=On(e,o.program,l,u),f=On(e,s.program,l,u),p=U(e,z,qn),m=U(e,Kt,Jn),h=On(e,c.program,[[`corner`,p,2]],m),g=kn(e,sn);e.texImage2D(B,0,en,64,64,0,$t,Yt,Bt(t));let _=kn(e,cn);e.texImage2D(B,0,en,r*2,r,0,$t,Yt,null),e.bindTexture(B,null);let v=e.createFramebuffer();if(v===null)throw Error(`The GPU body could not make a framebuffer.`);e.bindFramebuffer(V,v),e.framebufferTexture2D(V,ln,B,_,0);let y=e.checkFramebufferStatus(V)===un;if(e.bindFramebuffer(V,null),!y)throw Error(`The GPU body could not render into its halo target.`);return{haloTexels:r,rowCount:i.count,indexCount:a.index.length,indexType:a.index instanceof Uint16Array?Xt:Zt,quadKeys:a.keys,fragmentUniforms:Pt(),haloPlacement:{texelUnits:0,radiusFraction:0},shares:[0,0,0],haloUnion:o,strokes:s,haloLight:c,haloUnionArray:H(d),strokeArray:H(f),squareArray:H(h),sparkle:H(g),haloTexture:H(_),haloFramebuffer:H(v)}}function G(e,t,n){"worklet";t!=null&&(typeof n==`number`?e.uniform1f(t,n):n.length===2?e.uniform2f(t,n[0],n[1]):n.length===3?e.uniform3f(t,n[0],n[1],n[2]):n.length===4&&e.uniform4f(t,n[0],n[1],n[2],n[3]))}function er(e,t,n){"worklet";for(let r=0;r<Yn.length;r++){let i=Yn[r];G(e,t.uniforms[i],n[i].value)}}function tr(e,t,n,r){"worklet";let i=Nn(n,t.haloPlacement,t.haloTexels);e.bindFramebuffer(V,t.haloFramebuffer),e.viewport(0,0,t.haloTexels*2,t.haloTexels),e.clear(dn),e.enable(fn),e.blendEquationSeparate(yn,yn),e.blendFuncSeparate(1,1,1,1);let a=t.haloUnion;e.useProgram(a.program),er(e,a,t.fragmentUniforms),G(e,a.uniforms.texelUnits,i.texelUnits),G(e,a.uniforms.radiusFraction,i.radiusFraction),e.bindVertexArray(t.haloUnionArray),e.drawElements(4,r,t.indexType,0)}function nr(e,t,n,r){"worklet";let{camera:i}=n,a=t.strokes;e.useProgram(a.program),er(e,a,t.fragmentUniforms),e.uniformMatrix4fv(a.uniforms.modelViewMatrix,!1,i.modelView),e.uniformMatrix4fv(a.uniforms.projectionMatrix,!1,i.projection),G(e,a.uniforms.viewportHeight,Math.max(1,i.height)),G(e,a.uniforms.unitMetres,i.unitLength),G(e,a.uniforms.alphaFromLight,n.alphaFromLight),e.activeTexture(Qt),e.bindTexture(B,t.sparkle),e.uniform1i(a.uniforms.sparkle,0),e.bindVertexArray(t.strokeArray),e.drawElements(4,r,t.indexType,0)}function rr(e,t,n){"worklet";let{camera:r,state:i}=n,a=t.haloLight;e.useProgram(a.program),e.uniformMatrix4fv(a.uniforms.modelViewMatrix,!1,r.modelView),e.uniformMatrix4fv(a.uniforms.projectionMatrix,!1,r.projection),G(e,a.uniforms.viewRight,t.fragmentUniforms.viewRight.value),G(e,a.uniforms.viewUp,t.fragmentUniforms.viewUp.value),G(e,a.uniforms.halfSide,.5/i.radius),G(e,a.uniforms.haloShares,Fn(i.glowGain,t.shares)),G(e,a.uniforms.alphaFromLight,n.alphaFromLight),e.activeTexture(Qt),e.bindTexture(B,t.haloTexture),e.uniform1i(a.uniforms.halo,0),e.bindVertexArray(t.squareArray),e.drawElements(4,Jn.length,Xt,0)}function ir(e){"worklet";e.disable(mn),e.disable(pn),e.disable(hn),e.disable(gn),e.disable(_n)}function ar(e){"worklet";return e.fade>0&&e.state.arrival>0}function or(e,t,n){"worklet";if(ir(e),!ar(n))return;let{state:r,camera:i}=n;It(t.fragmentUniforms,r,i.basis,n.density,i.eyeDistance),tr(e,t,r.radius,Hn(t.quadKeys,n.density)*6)}function sr(e,t,n){"worklet";if(!ar(n))return;let{camera:r}=n;e.disable(hn),e.bindFramebuffer(V,null),e.viewport(0,0,r.width,r.height),e.enable(fn),e.blendEquationSeparate(vn,vn),e.blendFuncSeparate(bn,769,xn,771),e.blendColor(n.fade,n.fade,n.fade,n.fade),nr(e,t,n,Hn(t.quadKeys,n.density)*6),rr(e,t,n),e.bindVertexArray(null),e.bindTexture(B,null),e.disable(fn)}function cr(e,t,n){"worklet";ir(e),e.bindFramebuffer(V,null),e.clearColor(0,0,0,0),e.clear(dn),or(e,t,n),sr(e,t,n)}var lr=.2,ur=4,dr=25,fr=.25,pr=.08,mr=.3,hr=.6,gr=7*lr,_r=ur*lr;Math.max(2.4299999999999997,2+Math.max(.79,hr),hr);var vr=.82,yr=.95;vr+Math.sqrt(3)*x;var br={from:0,leaves:3,to:4,fades:7,light:8},xr={first:0,sweep:1,flares:2,light:3};Math.cos(Math.PI/180*dr);var Sr=0,Cr=1,wr=404,Tr=5;function Er(e){let t=[],n=new Map,r=[],i=i=>{let a=`${e[i]},${e[i+1]},${e[i+2]}`,o=n.get(a);return o===void 0?(n.set(a,r.length),t.push(e[i],e[i+1],e[i+2]),r.push([]),r.length-1):o},a=t=>Math.hypot(e[t],e[t+1],e[t+2]);for(let t=0;t<e.length;t+=10){if(e[t+9]!==1||a(t)<yr||a(t+3)<yr)continue;let n=i(t),o=i(t+3);n===o||r[n].includes(o)||(r[n].push(o),r[o].push(n))}let o=[0],s=[];for(let e of r)s.push(...e),o.push(s.length);let c=r.length,l=[],u=[],d=[];for(let e=0;e<c;e++){let[n,r,i]=[t[e*3],t[e*3+1],t[e*3+2]];l.push(Math.hypot(n,i)),u.push(Math.atan2(i,n)),d.push(Math.hypot(n,r,i))}let f=wr,p=f+c*Tr;return{nodes:t,firstLink:o,links:s,count:c,turnRadius:l,turnPhase:u,reach:d,slots:{seen:f,hops:[p,p+c],stamps:[p+c*2,p+c*3],clear:[p+c*4,p+c*5],judged:[p+c*6,p+c*7],reachedFrom:p+c*8,queue:p+c*9,size:p+c*10}}}function Dr(e){return e.slots.size}function Or(e,t){"worklet";return e===Sr?(t-1)*lr:0}function kr(e,t){"worklet";return(e===Sr?gr:_r)+fr+(t-1)*pr+mr}[Sr,Cr].flatMap(e=>Array.from({length:7},(t,n)=>{let r=ae*Or(e,n),i=ae*kr(e,n);return[r,Math.cos(r),Math.sin(r),i,Math.cos(i),Math.sin(i)]}).flat());var Ar={solid:0,sparkle:1,radial:2},jr=`
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
`,Mr=`
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

${jr}
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
  float flight = age / ${I(be)};
  float breakUp = clamp01((age - ${I(C)}) / ${I(be-C)});
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
  float headRadius = ${I(T+.06)} + speed * age;
  float streak = chipSize
    * (splinter > 0.5 ? 0.06 + 0.05 * hashInteger(shardSeed + 4.0) : 0.17 + 0.09 * hashInteger(seed + 7.0))
    * (1.0 - 0.3 * breakUp);
  // It streaks back along the way it came, but never from inside the edge it left.
  streak = min(streak, headRadius - ${I(T-.02)});
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
`,Nr=.99/256;function Pr(e){"worklet";return(256-e)/256}var Fr=1024,Ir=`
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

${jr}
const float PATH_DEPTH_SPAN = ${I(Nr)};

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
  float texel = clamp(position, 0.0, 1.0) * ${I(1023)} + 0.5;
  return texture(gradients, vec2(texel / ${I(Fr)}, (row + 0.5) / ${I(2)}));
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
  if (paintKind == ${Ar.sparkle}) {
    paint.rgb *= texture(sparkle, local / ${I(zt)}).r;
  } else if (paintKind == ${Ar.radial}) {
    paint *= gradientAt(gradient.x, length(local) / gradient.y);
  }
  colour = paint * covered;
}
`,Lr=12,Rr=.2;function zr(e){"worklet";return e===77||e===109||e===76||e===108||e===72||e===104||e===86||e===118||e===65||e===97||e===67||e===99||e===81||e===113||e===90||e===122}function Br(e){"worklet";return e>=48&&e<=57||e===45||e===46||e===43}function Vr(e){"worklet";return e>=48&&e<=57}function Hr(e,t){"worklet";let n=t;for(;n<e.length&&Vr(e.charCodeAt(n));)n++;return n}function Ur(e,t){"worklet";let n=Hr(e,t+1);return e[t]!==`.`&&e[n]===`.`&&(n=Hr(e,n+1)),(e[n]===`e`||e[n]===`E`)&&(n++,(e[n]===`-`||e[n]===`+`)&&n++,n=Hr(e,n)),n}function Wr(e,t,n){"worklet";return e.toLowerCase()===`a`&&(t%7==3||t%7==4)&&(n===48||n===49)}function Gr(e){"worklet";let t=[],n=0,r=0,i=``;for(;n<e.length;){let a=e.charCodeAt(n);if(zr(a))i=e[n],t.push(i),r=0,n++;else if(!Br(a))n++;else{let o=Wr(i,r,a)?n+1:Ur(e,n);t.push(Number(e.slice(n,o))),r++,n=o}}return t}function Kr(e,t,n){"worklet";e.push(t,n)}function qr(e,t,n){"worklet";let r=t.length/2;if(r<2)return;let i=r-1;for(let a=1;a<r;a++){let r=a>1||n,o=a<i||n;e.push(t[(a-1)*2],t[(a-1)*2+1],t[a*2],t[a*2+1],+!!r+(o?2:0))}}function Jr(e,t,n,r,i,a,o,s,c,l){"worklet";let u=Math.abs(r),d=Math.abs(i);if(u===0||d===0||t===c&&n===l){Kr(e,c,l);return}let f=a*Math.PI/180,p=Math.cos(f),m=Math.sin(f),h=(t-c)/2,g=(n-l)/2,_=p*h+m*g,v=-m*h+p*g,y=_*_/(u*u)+v*v/(d*d);y>1&&(u*=Math.sqrt(y),d*=Math.sqrt(y));let b=u*u*d*d-u*u*v*v-d*d*_*_,ee=u*u*v*v+d*d*_*_,x=Math.sqrt(Math.max(0,b/ee))*(o===s?-1:1),S=x*u*v/d,C=-x*d*_/u,w=p*S-m*C+(t+c)/2,te=m*S+p*C+(n+l)/2,T=Math.atan2((v-C)/d,(_-S)/u),E=Math.atan2((-v-C)/d,(-_-S)/u)-T;s===0&&E>0&&(E-=Math.PI*2),s===1&&E<0&&(E+=Math.PI*2);let D=Math.max(1,Math.ceil(Math.abs(E)/Rr));for(let t=1;t<=D;t++){let n=T+E*t/D,r=Math.cos(n)*u,i=Math.sin(n)*d;Kr(e,t===D?c:w+p*r-m*i,t===D?l:te+m*r+p*i)}}function Yr(e,t,n,r,i,a,o,s,c){"worklet";for(let l=1;l<=Lr;l++){let u=l/Lr,d=1-u;Kr(e,d*d*d*t+3*d*d*u*r+3*d*u*u*a+u*u*u*s,d*d*d*n+3*d*d*u*i+3*d*u*u*o+u*u*u*c)}}function K(e,t){"worklet";let n=e[t];return typeof n==`number`?n:NaN}function Xr(e,t,n,r,i,a){"worklet";let o=i+K(t,n),s=a+K(t,n+1);return r?(qr(e.runs,e.points,!1),e.points=[o,s],e.startX=o,e.startY=s):Kr(e.points,o,s),e.x=o,e.y=s,n+2}function Zr(e,t,n,r,i){"worklet";let a=r+K(t,n),o=i+K(t,n+1),s=r+K(t,n+2),c=i+K(t,n+3);return Yr(e.points,e.x,e.y,e.x+(a-e.x)*2/3,e.y+(o-e.y)*2/3,s+(a-s)*2/3,c+(o-c)*2/3,s,c),e.x=s,e.y=c,n+4}function Qr(e,t,n,r,i){"worklet";let a=r+K(t,n+4),o=i+K(t,n+5);return Yr(e.points,e.x,e.y,r+K(t,n),i+K(t,n+1),r+K(t,n+2),i+K(t,n+3),a,o),e.x=a,e.y=o,n+6}function $r(e,t,n,r,i){"worklet";let a=r+K(t,n+5),o=i+K(t,n+6);return Jr(e.points,e.x,e.y,K(t,n),K(t,n+1),K(t,n+2),K(t,n+3),K(t,n+4),a,o),e.x=a,e.y=o,n+7}function ei(e){"worklet";(e.x!==e.startX||e.y!==e.startY)&&Kr(e.points,e.startX,e.startY),qr(e.runs,e.points,e.points.length>4),e.x=e.startX,e.y=e.startY,e.points=[e.x,e.y]}function ti(e,t,n,r){"worklet";let i=r.toLowerCase(),a=r===i?e.x:0,o=r===i?e.y:0;return i===`m`||i===`l`?Xr(e,t,n,i===`m`,a,o):i===`h`||i===`v`?(i===`h`?e.x=a+K(t,n):e.y=o+K(t,n),Kr(e.points,e.x,e.y),n+1):i===`q`?Zr(e,t,n,a,o):i===`c`?Qr(e,t,n,a,o):i===`a`?$r(e,t,n,a,o):-1}function ni(e){"worklet";return e===`M`?`L`:e===`m`?`l`:e}function ri(e){"worklet";let t=Gr(e),n={x:0,y:0,startX:0,startY:0,points:[],runs:[]},r=``,i=0;for(;i<t.length;){let e=t[i];if(typeof e==`string`)r=e,i++,(r===`Z`||r===`z`)&&ei(n);else{if(i=ti(n,t,i,r),i<0)return[];r=ni(r)}}return qr(n.runs,n.points,!1),n.runs.every(Number.isFinite)?n.runs:[]}var ii=.53,ai={coreGlow:{row:0,radius:ii},aura:{row:1,radius:N}};function oi(e,t){return{colours:t.map(([,e])=>e),positions:t.map(([t])=>t/e)}}var si=oi(ii,[[0,`#e07c3c76`],[.34*s,`#e4823f7c`],[.63*s,`#ea8a4690`],[.8*s,`#f0964eac`],[.93*s,`#f8a85ecc`],[s,`#ffb878d8`],[s+.025,`#f08e4aa0`],[s+.06,`#e4743458`],[s+.11,`#d8642a1c`],[ii,`#d45a2200`]]),ci=oi(N,[[0,`#d45a2200`],[k,`#d45a2200`],[.62,`#dc642810`],[T-.08,`#e672308c`],[T,`#ea7834ff`],[.98,`#e26c2ec0`],[1.12,`#d45a225c`],[1.3,`#bc4c1a1c`],[N,`#a4401600`]]);function li(e){let t=e.replace(`#`,``),n=e=>Number.parseInt(t.slice(e,e+2),16)/255;if(!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(t))throw Error(`Not a colour the picture can paint: ${e}`);return[n(0),n(2),n(4),t.length===8?n(6):1]}function ui(e,t){let{colours:n,positions:r}=e,i=r.length-1,a=0;for(;a<i&&r[a+1]<=t;)a++;let o=li(n[a]);if(a===i||t<=r[0]){let e=t<=r[0]?li(n[0]):o;return[e[0]*e[3],e[1]*e[3],e[2]*e[3],e[3]]}let s=li(n[a+1]),c=r[a+1]-r[a],l=c>0?(t-r[a])/c:0,u=o.map((e,t)=>e+(s[t]-e)*l);return[u[0]*u[3],u[1]*u[3],u[2]*u[3],u[3]]}function di(){let e=[[ai.coreGlow.row,si],[ai.aura.row,ci]],t=new Uint8Array(Fr*2*4);for(let[n,r]of e)for(let e=0;e<Fr;e++){let i=ui(r,e/(Fr-1)),a=(n*Fr+e)*4;for(let e=0;e<4;e++)t[a+e]=Math.round(i[e]*255)}return t}function q(e,t){return`${Mr}\n${e}\nvoid main() {\n${t}\n}\n`}function J(e,t,n){return{name:e,size:t,values:n.flat()}}var fi=8;function pi(e,t){let[,n,r,i,a,o]=t,[s,c]=e,l=[];for(let e=1;e<=fi;e++){let t=e/fi,u=(1-t)*(1-t),d=2*o*t*(1-t),f=t*t,p=u+d+f;l.push([(u*s+d*n+f*i)/p,(u*c+d*r+f*a)/p])}return l}function mi(e){let t=[],n=[];for(let r=0;r<e.count;r++){let i=e.commands[r],a=i[0];a===0?(n.length>1&&t.push(n),n=[[i[1],i[2]]]):a===1?n.push([i[1],i[2]]):a===3&&n.push(...pi(n[n.length-1]??[0,0],i))}return n.length>1&&t.push(n),t}function hi(e){let t=[],n=[];for(let r of mi(e)){let e=r.length-1,i=e>1&&r[0][0]===r[e][0]&&r[0][1]===r[e][1];for(let a=1;a<=e;a++){let o=a>1||i,s=a<e||i;t.push([...r[a-1],...r[a]]),n.push([+!!o+(s?2:0)])}}return{ends:t,joins:n}}var gi=[`coreRing`,`coreBar`],_i=q(`
in vec4 ends;
in float joins;
uniform float halfWidth;
`,`
  emitRun(ends.xy, ends.zw, halfWidth, joins, 1.0, 1.0);
`);function vi(e){let t=[],n=[],r={};for(let i of gi){let a=hi(e[i]);r[i]={first:t.length,count:a.ends.length},t.push(...a.ends),n.push(...a.joins)}return{layer:{vertexShader:_i,uniforms:[`halfWidth`],attributes:[J(`ends`,4,t),J(`joins`,1,n)],shapes:t.length},ranges:r}}function yi(){return{vertexShader:q(`
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
`),uniforms:[`arc`,`arcEnds`,`arcLumps`],attributes:[J(`piece`,1,Array.from({length:32},(e,t)=>[t]))],shapes:32}}function bi(){return{vertexShader:q(`
in float shape;
uniform vec3 disc;
`,`
  emitDisc(disc.xy, disc.z);
`),uniforms:[`disc`],attributes:[J(`shape`,1,[[0]])],shapes:1}}var xi=.42,Si=.15,Ci=[`x`,`y`,`z`];function wi(e){let[t,n,i]=r[e],a=Ci[(e+1)%3],o=Ci[(e+2)%3];return`sin(time * ${I(t)} + node.${a} * ${I(n)} + node.${o} * ${I(i)})`}var Ti=`
uniform vec2 bodyTurn;
uniform float time;

vec3 turnedNode(vec3 node) {
  vec3 sway = vec3(
    ${Ci.map((e,t)=>wi(t)).join(`,
    `)}
  ) * ${I(x)};
  vec3 at = node + sway;
  return vec3(at.x * bodyTurn.x + at.z * bodyTurn.y, at.y, at.z * bodyTurn.x - at.x * bodyTurn.y);
}
`;function Ei(e){let t=[],n=[],r=[];for(let i=0;i<e.cage.length;i+=10)t.push(e.cage.slice(i,i+3)),n.push(e.cage.slice(i+3,i+6)),r.push(e.cage.slice(i+6,i+10));return{vertexShader:q(`
in vec3 edgeFrom;
in vec3 edgeTo;
in vec4 edgeClock;
uniform float halfWidth;
${Ti}
// How lit a turned node is: fainter towards his back, and where it lies across his face.
float nodeLight(vec3 turned) {
  float front = smooth01((turned.z + 1.2) / 2.4);
  float aside = smooth01((length(turned.xy) - 0.3) / 0.55);
  return (0.6 + 0.4 * front) * (0.25 + 0.75 * aside);
}

// How near an edge, seen flat, comes to his core.
float nearestToTheCore(vec2 from, vec2 to) {
  vec2 core = vec2(${I(a)}, ${I(_)});
  vec2 run = to - from;
  float share = clamp(dot(core - from, run) / max(dot(run, run), 1e-6), 0.0, 1.0);
  return length(from + run * share - core);
}
`,`
  // edgeClock: its twinkle's rate (cycles a second) and phase, the edge's weight, and how lit its
  // far end is as a share of its near one's.
  vec3 from = turnedNode(edgeFrom);
  vec3 to = turnedNode(edgeTo);
  float clearOfTheCore = smooth01((nearestToTheCore(from.xy, to.xy) - ${I(xi)}) / ${I(Si)});
  if (clearOfTheCore <= 0.0) {
    hide();
    return;
  }
  float twinkle = 0.55 + 0.45 * smooth01(0.5 + 0.5 * sin((time * edgeClock.x + edgeClock.y) * TAU));
  emitSegment(from.xy, to.xy, halfWidth, 1.0, 1.0);
  shapeLight = clearOfTheCore * edgeClock.z * twinkle * (corner.x < 0.0 ? nodeLight(from) : edgeClock.w * nodeLight(to));
`),uniforms:[`bodyTurn`,`time`,`halfWidth`],attributes:[J(`edgeFrom`,3,t),J(`edgeTo`,3,n),J(`edgeClock`,4,r)],shapes:t.length}}var Di={wire:0,spark:1,head:2,flash:3,box:4},Oi=.8,ki=.3,Ai=.75,ji=.16,Mi=.035,Ni=.1,Pi=.3,Fi=.1,Ii=.7,Li=.95,Ri=.12,zi=4,Bi=.1,Vi=10,Hi=158,Ui=3,Wi=156;function Gi(e,t,n=1){let r=t%4;if(r+n>4)throw Error(`The cascades' numbers ${t} to ${t+n-1} straddle two vec4s.`);return`cascade[${e} + ${Math.floor(t/4)}].${`xyzw`.slice(r,r+n)}`}function Ki(e,t){return Gi(`${Wi} + ${e}`,t)}function qi(){let e=br,t=xr,n=hr*Bi;return{vertexShader:q(`
in float cascadeEdge;
uniform float halfWidth;
uniform float cascadePart;
uniform float rimRoll;
uniform vec4 cascade[${Hi}];
${Ti}
// How much of its light a stroke keeps seen \`reach\` out: less over his bright edge and the truss,
// where it Screens over his specks.
float overHim(float reach) {
  return mix(${I(Ii)}, 1.0, smooth01((reach - ${I(Li)}) / ${I(Ri)}));
}

// Where a clock degree of the truss's own frame is seen, \`reach\` out: rolled with the truss, y down.
vec2 onTheTruss(float clock, float reach) {
  float radians = (clock + rimRoll) * DEGREES;
  return vec2(sin(radians), -cos(radians)) * reach;
}

// A box's flare: its rungs and its rails, piece by piece, as lit as its flare has got.
void emitBox(int shape) {
  int box = shape / ${Vi};
  int piece = shape - box * ${Vi};
  float first = ${Ki(`box`,t.first)};
  float sweep = ${Ki(`box`,t.sweep)};
  float light = ${Ki(`box`,t.light)};
  float age = time - ${Ki(`box`,t.flares)};
  float flare = smooth01(age / ${I(n)})
    * (1.0 - smooth01((age - ${I(n)}) / ${I(hr*.9)}));
  if (light <= 0.0 || sweep <= 0.0 || flare <= 0.0) {
    hide();
    return;
  }
  if (piece < 2) {
    float clock = first + sweep * float(piece);
    emitSegment(onTheTruss(clock, ${I(j)}), onTheTruss(clock, ${I(ye)}), halfWidth, 1.0, 1.0);
  } else {
    int railPiece = piece - 2;
    int rail = railPiece / ${zi};
    float along = float(railPiece - rail * ${zi});
    float reach = rail == 0 ? ${I(ye)} : ${I(j)};
    float step = sweep / ${I(zi)};
    emitSegment(onTheTruss(first + step * along, reach), onTheTruss(first + step * (along + 1.0), reach), halfWidth, 1.0, 1.0);
  }
  shapeLight = light * flare;
}
`,`
  int shape = int(cascadeEdge + 0.5);
  int part = int(cascadePart + 0.5);
  bool boxShape = shape >= 52;
  if (boxShape != (part == ${Di.box})) {
    hide();
    return;
  }
  if (boxShape) {
    emitBox(shape - 52);
    return;
  }
  int at = shape * ${Ui};
  float leaves = ${Gi(`at`,e.leaves)};
  float fades = ${Gi(`at`,e.fades)};
  float light = ${Gi(`at`,e.light)};
  float hop = ${I(lr)};
  float age = time - leaves;
  float along = age / hop;
  float fade = 1.0 - smooth01((time - fades) / ${I(mr)});
  if (light <= 0.0 || along <= 0.0 || fade <= 0.0) {
    hide();
    return;
  }
  vec2 from = turnedNode(${Gi(`at`,e.from,3)}).xy;
  vec2 to = turnedNode(${Gi(`at`,e.to,3)}).xy;
  vec2 run = to - from;
  float runLength = max(length(run), 1e-3);
  float head = min(along, 1.0);
  vec2 headAt = from + run * head;
  // the wire is lit up to the comet's tail, and the comet over the rest, so the two never stack
  vec2 cometTailAt = from + run * clamp(along - ${I(ji)} / runLength, 0.0, 1.0);
  if (part == ${Di.wire}) {
    if (along * runLength < ${I(ji*.25)}) {
      hide();
      return;
    }
    emitSegment(from, cometTailAt, halfWidth, 1.0, 1.0);
    float settled = smooth01((along - 1.0) * hop / ${I(ki)});
    float tip = mix(1.0, ${I(Oi)}, settled);
    float root = mix(${I(Ai)}, ${I(Oi)}, settled);
    vec2 cornerAt = corner.x < 0.0 ? from : cometTailAt;
    shapeLight = light * fade * (corner.x < 0.0 ? root : tip) * overHim(length(cornerAt));
    return;
  }
  bool nodeFlash = part == ${Di.flash};
  float flash = 1.0 - smooth01((age - hop) / (nodeFlash ? ${I(Pi)} : ${I(Ni)}));
  if (flash <= 0.0) {
    hide();
    return;
  }
  if (nodeFlash) {
    // the node it lands on bursts as it lands, and goes out
    if (along < 1.0) {
      hide();
      return;
    }
    emitSegment(to, to, halfWidth, 1.0, 1.0);
    shapeLight = light * flash * overHim(length(to));
    return;
  }
  // the comet (spark) runs back from the head over its length; the head over a short one
  bool comet = part == ${Di.spark};
  vec2 tailAt = comet ? cometTailAt : from + run * clamp(along - ${I(Mi)} / runLength, 0.0, 1.0);
  emitSegment(tailAt, headAt, halfWidth, 1.0, 1.0);
  vec2 cornerAt = corner.x < 0.0 ? tailAt : headAt;
  float trailing = comet && corner.x < 0.0 ? ${I(Fi)} : 1.0;
  shapeLight = light * flash * trailing * overHim(length(cornerAt));
`),uniforms:[`bodyTurn`,`time`,`halfWidth`,`cascadePart`,`rimRoll`,`cascade`],attributes:[J(`cascadeEdge`,1,Array.from({length:72},(e,t)=>[t]))],shapes:72}}function Ji(e){let t=[],n=[];for(let r=0;r<e.embers.length;r+=7)t.push(e.embers.slice(r,r+4)),n.push(e.embers.slice(r+4,r+7));return{vertexShader:q(`
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
  vec2 drifting = outward + vec2(0.0, ${I(-ue)});
  vec2 at = outward * emberPath.y + drifting * emberPath.z * life;
  emitSegment(at - normalize(drifting) * emberMore.y, at, halfWidth, 1.0, 1.0);
  shapeLight = shown;
`),uniforms:[`time`,`share`,`halfWidth`],attributes:[J(`emberPath`,4,t),J(`emberMore`,3,n)],shapes:t.length}}function Yi(e){let t=[],n=[],r=[];for(let i=0;i<e.fray.length;i+=5)t.push(e.fray.slice(i,i+4)),n.push([e.fray[i+4],0]),r.push([0]);for(let i=0;i<e.streakArcs.length;i+=6)t.push(e.streakArcs.slice(i,i+4)),n.push(e.streakArcs.slice(i+4,i+6)),r.push([1]);for(let i=0;i<e.limbStreaks.length;i+=5)t.push(e.limbStreaks.slice(i,i+4)),n.push([e.limbStreaks[i+4],0]),r.push([2]);return{vertexShader:q(`
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
    emitArcPiece(vec2(0.0), ${I(T)} + 0.17 * life, halfWidth, centre - sweep / 2.0, sweep, 0.0, 1.0, 0.0, 0.0);
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
  float head = sqrt(max(${I(T*T)} - y * y, 0.0)) + 0.3 * life;
  emitSegment(vec2(head - frayRow.y * visible, y), vec2(head, y), halfWidth, 0.0, 0.0);
`),uniforms:[`drive`,`time`,`halfWidth`],attributes:[J(`frayRow`,4,t),J(`frayMore`,2,n),J(`frayKind`,1,r)],shapes:t.length}}var Xi=[`streak`,`core`],Zi=5,Qi=3,$i=2,ea=.5;function ta(){let e=[],t={};return Xi.forEach((n,r)=>{let i=e.length;for(let t=0;t<Zi;t++)for(let n=0;n<Qi;n++)for(let i=0;i<$i;i++)e.push([t,n,i,r]);t[n]={first:i,count:e.length-i}}),{layer:{vertexShader:q(`
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
  shapeLight = light * (corner.x < 0.0 ? ${I(ea)} : 1.0);
`),uniforms:[`burst`,`halfWidth`],attributes:[J(`chipShape`,4,e)],shapes:e.length},ranges:t}}var na=8,ra=160,ia=16769732,aa=16759936,oa=16751174,sa=15496242,ca=14047778,la=[`toSquare`,`localPerPixel`,`paintColour`,`paintKind`,`sparkle`,`gradients`,`gradient`,`pathDepth`];function ua(e){if(e*4>65535)throw Error(`A layer of the picture has more shapes than a 16-bit index can draw.`);let t=new Float32Array(e*8),n=new Uint16Array(e*6);for(let r=0;r<e;r++)t.set([-1,-1,1,-1,1,1,-1,1],r*8),n.set([0,1,2,0,2,3].map(e=>r*4+e),r*6);return{corners:t,index:n}}function da(e,t,n,r){let i=new Float32Array(t*4*n);for(let e=0;e<t;e++){let t=r.slice(e*n,(e+1)*n);for(let r=0;r<4;r++)i.set(t,(e*4+r)*n)}return U(e,z,i)}function Y(e,t,n){let r=Dn(e,t.vertexShader,Ir,[...la,...t.uniforms]),{corners:i,index:a}=ua(t.shapes),o=n??t.attributes.map(({name:n,size:r,values:i})=>[n,da(e,t.shapes,r,i),r]);o.push([`corner`,U(e,z,i),2]);let s=e.createVertexArray();if(s===null)throw Error(`The picture could not make a vertex array.`);e.bindVertexArray(s);for(let[t,n,i]of o){let a=e.getAttribLocation(r.program,t);a<0||(e.bindBuffer(z,n),e.enableVertexAttribArray(a),e.vertexAttribPointer(a,i,Jt,!1,0,0))}return e.bindBuffer(Kt,U(e,Kt,a)),e.bindVertexArray(null),{program:r,array:H(s),shapes:t.shapes}}function fa(e,t){let n=vi(w()),r=ta(),i=Er(t.cage),a=t=>{let n=U(e,z,new Float32Array(5120*t));return e.bufferData(z,new Float32Array(5120*t),Sn),n},o=a(4),s=a(1),c={vertexShader:_i,uniforms:[`halfWidth`],attributes:[],shapes:1280},l=kn(e,sn);e.texImage2D(B,0,en,64,64,0,$t,Yt,Bt(t));let u=kn(e,cn);return e.texImage2D(B,0,en,Fr,2,0,$t,Yt,di()),e.bindTexture(B,null),{segments:Y(e,n.layer),glyphs:Y(e,c,[[`ends`,o,4],[`joins`,s,1]]),arc:Y(e,yi()),disc:Y(e,bi()),cage:Y(e,Ei(t)),cascade:Y(e,qi()),embers:Y(e,Ji(t)),fray:Y(e,Yi(t)),chips:Y(e,r.layer),paths:n.ranges,chipParts:r.ranges,sparkle:H(l),gradients:H(u),glyphEnds:H(o),glyphJoins:H(s),glyphSlots:Array(na).fill(``),glyphRuns:Array(na).fill(0),cascadeNet:i,cascadeScratch:Array(Dr(i)).fill(0),cascadeEdges:new Float32Array(632),matrix:new Float32Array(9),stencil:[0]}}function pa(e){"worklet";return e>0?e>1?1:e:0}function X(e,t){"worklet";let n=t.stencil[0]+1;n>255&&(e.depthMask(!0),e.clear(Cn|256),n=1),t.stencil[0]=n,e.stencilFunc(517,n,255)}function ma(e,t,n,r,i,a,o){"worklet";let s=n.program.uniforms;e.useProgram(n.program.program),e.bindVertexArray(n.array);let c=t.matrix;c[0]=r,c[1]=0,c[2]=0,c[3]=0,c[4]=r,c[5]=0,c[6]=i,c[7]=a,c[8]=1,s.toSquare&&e.uniformMatrix3fv(s.toSquare,!1,c),s.localPerPixel&&e.uniform1f(s.localPerPixel,1/(r*o)),s.sparkle&&e.uniform1i(s.sparkle,0),s.gradients&&e.uniform1i(s.gradients,1)}function ha(e,t,n,r){"worklet";ma(e,t,n,r.state.radius,.5,.5,r.pixels)}function ga(e,t,n,r){"worklet";ma(e,t,n,r.state.radius*r.state.shellReach,.5,.5,r.pixels)}function _a(e,t,n,r){"worklet";let i=r.state.radius;ma(e,t,n,i,.5+i*a,.5+i*_,r.pixels)}function va(e,t,n,r,i){"worklet";let a=t.program.uniforms,o=(r>>16&255)/255,s=(r>>8&255)/255,c=(r&255)/255;a.paintColour&&e.uniform4f(a.paintColour,o*i,s*i,c*i,i),a.paintKind&&e.uniform1i(a.paintKind,n)}function Z(e,t,n,r){"worklet";va(e,t,Ar.solid,n,r)}function ya(e,t,n,r,i){"worklet";let a=t.program.uniforms;a.paintColour&&e.uniform4f(a.paintColour,n,n,n,n),a.paintKind&&e.uniform1i(a.paintKind,Ar.radial),a.gradient&&e.uniform2f(a.gradient,r,i)}function Q(e,t,n,r){"worklet";let i=e.program.uniforms[n];i&&t.uniform1f(i,r)}function $(e,t,n,r,i){"worklet";if(i<=0)return;let a=n.program.uniforms.pathDepth;a&&e.uniform1f(a,Pr(t.stencil[0])),e.colorMask(!1,!1,!1,!1),e.depthMask(!0),e.depthFunc(513),e.stencilOp(wn,wn,wn),e.drawElements(4,i*6,Xt,r*12),e.colorMask(!0,!0,!0,!0),e.depthMask(!1),e.depthFunc(514),e.stencilOp(wn,wn,Tn),e.drawElements(4,i*6,Xt,r*12)}function ba(e,t,n,r,i,a){"worklet";let o=t.segments;Z(e,o,i,a),Q(o,e,`halfWidth`,r),X(e,t),$(e,t,o,n.first,n.count)}function xa(e,t,n,r,i,a){"worklet";let o=t.arc,s=o.program.uniforms;s.arc&&e.uniform4f(s.arc,0,0,n,r),s.arcEnds&&e.uniform4f(s.arcEnds,0,Math.PI*2,32,0),s.arcLumps&&e.uniform2f(s.arcLumps,i,a),$(e,t,o,0,32)}var Sa=.24;function Ca(e,t,n){"worklet";let r=n.state,i=Sa*r.auraAlpha*r.glowGain;if(i<=0)return;let a=t.arc;X(e,t),ga(e,t,a,n),ya(e,a,pa(i),ai.aura.row,ai.aura.radius),xa(e,t,(k+N)/2,(N-k)/2,0,0)}var wa=.3;function Ta(e,t,n,r,i,a){"worklet";let o=t.arc;X(e,t),_a(e,t,o,n),Z(e,o,i,a),xa(e,t,n.state.coreRing,r,wa,n.state.roll*Math.PI/180)}function Ea(e,t,n){"worklet";let r=n.state,i=r.coreAlpha;if(i<=0)return;let a=i*r.coreDrift,o=a*r.coreGlow,s=t.disc;X(e,t),_a(e,t,s,n),ya(e,s,pa(o),ai.coreGlow.row,ai.coreGlow.radius),s.program.uniforms.disc&&e.uniform3f(s.program.uniforms.disc,0,0,ai.coreGlow.radius),$(e,t,s,0,1);let c=t.paths;_a(e,t,t.segments,n),ba(e,t,c.coreRing,.024/2,oa,.3*o),ba(e,t,c.coreRing,.01/2,aa,.6*o),ba(e,t,c.coreBar,.008/2,aa,.16*o),Ta(e,t,n,.024/2,oa,pa(.7*a)),Ta(e,t,n,.009/2,ia,pa(.9*a))}function Da(e,t,n,r){"worklet";let i=r.state;ga(e,t,n,r);let a=n.program.uniforms.bodyTurn;a&&e.uniform2f(a,i.bodyCos,i.bodySin),Q(n,e,`time`,i.time)}function Oa(e,t,n,r,i){"worklet";X(e,t),Q(n,e,`halfWidth`,i/r.state.shellReach),$(e,t,n,0,n.shapes)}function ka(e,t,n){"worklet";let r=n.state.cageAlpha;if(r<=0)return;let i=t.cage;Da(e,t,i,n),va(e,i,Ar.solid,ca,.15*r),Oa(e,t,i,n,.034/2),va(e,i,Ar.sparkle,aa,pa(.9*r)),Oa(e,t,i,n,.011/2)}function Aa(e,t,n,r,i,a){"worklet";let o=t.embers,s=n.state;X(e,t),ga(e,t,o,n),Z(e,o,i,a),Q(o,e,`time`,s.time),Q(o,e,`share`,s.emberShare),Q(o,e,`halfWidth`,r/s.shellReach),$(e,t,o,0,o.shapes)}function ja(e,t,n){"worklet";let r=n.state.cageAlpha;r<=0||(Aa(e,t,n,.032/2,ca,.32*r),Aa(e,t,n,.011/2,aa,pa(r)))}function Ma(e,t,n,r,i,a){"worklet";let o=t.fray,s=n.state;X(e,t),ha(e,t,o,n),Z(e,o,i,a),Q(o,e,`drive`,s.frayDrive),Q(o,e,`time`,s.time),Q(o,e,`halfWidth`,r),$(e,t,o,0,o.shapes)}function Na(e,t,n){"worklet";n.state.frayDrive<=.02||(Ma(e,t,n,.02/2,ca,.22),Ma(e,t,n,.0065/2,oa,.75))}function Pa(e,t,n,r,i,a,o){"worklet";let s=t.chips,c=n.state;X(e,t),ha(e,t,s,n),Z(e,s,a,o),Q(s,e,`halfWidth`,i);let l=s.program.uniforms.burst;l&&e.uniform4f(l,c.burstAge,c.burstCount,c.burstReach,c.burstStrength),$(e,t,s,r.first,r.count)}function Fa(e,t,n){"worklet";let r=n.state;if(r.burstAge>=.2||r.burstStrength<=0)return;let i=t.chipParts;Pa(e,t,n,i.streak,.045/2,ca,.35),Pa(e,t,n,i.streak,.017/2,oa,.95),Pa(e,t,n,i.core,.007/2,ia,.55)}function Ia(e,t,n,r){"worklet";if(t.glyphSlots[n]===r)return;let i=ri(r);i.length===0&&(i=ri(Le));let a=Math.min(ra,i.length/5),o=new Float32Array(a*16),s=new Float32Array(a*4);for(let e=0;e<a;e++)for(let t=0;t<4;t++){for(let n=0;n<4;n++)o[e*16+t*4+n]=i[e*5+n];s[e*4+t]=i[e*5+4]}let c=n*ra*4;e.bindBuffer(z,t.glyphEnds),e.bufferSubData(z,c*16,o),e.bindBuffer(z,t.glyphJoins),e.bufferSubData(z,c*4,s),t.glyphSlots[n]=r,t.glyphRuns[n]=a}function La(e,t,n,r,i){"worklet";ma(e,t,n,i.glyphRadius,i.centreX,i.centreY,r.pixels)}function Ra(e,t,n,r,i,a,o){"worklet";let s=t.disc;X(e,t),La(e,t,s,n,r),Z(e,s,a,o);let c=s.program.uniforms.disc;c&&e.uniform3f(c,0,0,i),$(e,t,s,0,1)}function za(e,t,n,r,i,a,o){"worklet";let s=t.glyphs;for(let c=0;c<(o>0?2:1);c++)X(e,t),La(e,t,s,n,r),Z(e,s,c===0?sa:oa,c===0?a*(1-o):a*o),Q(s,e,`halfWidth`,at/2),$(e,t,s,i*ra,t.glyphRuns[i])}function Ba(e,t,n,r,i,a){"worklet";let o=t.arc;X(e,t),La(e,t,o,n,r),Z(e,o,oa,i*a),xa(e,t,1.75-.95*a,.07/2,0,0)}function Va(e,t,n,r,i,a,o){"worklet";let s=Math.min(1,.16*a*(1+1.5*o));Ra(e,t,n,r,1.15,ca,s),Ra(e,t,n,r,.7,ca,s),za(e,t,n,r,i,a,o),Ra(e,t,n,r,.1,oa,a*(.6+.4*o)),o>0&&Ba(e,t,n,r,a,o)}function Ha(e,t,n){"worklet";let r=n.satellites,i=0;for(let a=0;a<r.length&&i<na;a++){let o=r[a],s=o===void 0?void 0:ct(o,n.state.time);o!==void 0&&s!==void 0&&(Ia(e,t,i,o.glyph),Va(e,t,n,{centreX:.5+s.across*O,centreY:.5-s.up*O,glyphRadius:s.glyphRadii*O},i,s.light,o.flare),i++)}}function Ua(e,t){"worklet";e.enable(fn),e.blendEquation(vn),e.blendFuncSeparate(1,769,1,771),e.enable(hn),e.stencilMask(255),e.enable(mn),t.stencil[0]=0}function Wa(e){"worklet";e.disable(hn),e.disable(mn),e.depthMask(!0),e.bindVertexArray(null)}function Ga(e,t,n){"worklet";Ua(e,t),e.activeTexture(Qt),e.bindTexture(B,t.sparkle),e.activeTexture(Qt+1),e.bindTexture(B,t.gradients),e.activeTexture(Qt),Ca(e,t,n),Ea(e,t,n),ka(e,t,n),ja(e,t,n),Na(e,t,n),Fa(e,t,n),Ha(e,t,n),Wa(e)}function Ka(e){"worklet";let t=Math.hypot(e[0],e[1],e[2]);return t<1e-6?null:[e[0]/t,e[1]/t,e[2]/t]}function qa(e,t){"worklet";return[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]]}function Ja(e,t){"worklet";return e[0]*t[0]+e[1]*t[1]+e[2]*t[2]}function Ya(e,t){"worklet";return Ka([t.x-e.x,0,t.z-e.z])??[0,0,1]}function Xa(e){"worklet";return{right:[e[2],0,-e[0]],up:[0,1,0],front:e}}function Za(e,t,n){"worklet";let r=Ka([t.x-e.x,t.y-e.y,t.z-e.z]);if(r===null)return n??vt;let i=Ka([-r[1]*r[0],1-r[1]*r[1],-r[1]*r[2]]);return i===null?n??vt:{right:qa(i,r),up:i,front:r}}function Qa(e,t){"worklet";let n=e=>[Ja(e,t.right),Ja(e,t.up),Ja(e,t.front)];return{right:n(e.right),up:n(e.up),front:n(e.front)}}var $a={blending:5,blendEquation:100,blendSrc:211,blendDst:203,blendEquationAlpha:100,blendSrcAlpha:213,blendDstAlpha:205};function eo(e,t){e.blendColor.setScalar(t),e.blendAlpha=t}var to=.85,no=`
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
`,ro=`
precision highp float;

uniform sampler2D picture;
uniform float alphaFromLight;

in vec2 targetCoordinate;

out vec4 colour;

${Pn}

void main() {
  // Raw encoded sRGB, exactly as the picture wrote it, premultiplied light over transparent black:
  // the projection layer is treated as sRGB and premultiplied, so blending these values matches
  // what the phone's Screen blend does.
  vec3 light = texture(picture, targetCoordinate).rgb;
  vec3 glow = haloGlow(targetCoordinate);
  light = light + glow - light * glow;
  colour = vec4(light, alphaFromLight * max(light.r, max(light.g, light.b)));
}
`;function io(e,t){let n=new ke({glslVersion:Oe,vertexShader:no,fragmentShader:ro,uniforms:{picture:{value:t},halo:{value:null},haloShares:{value:new Ee},alphaFromLight:{value:to}},transparent:!0,depthWrite:!1,premultipliedAlpha:!0,...$a});eo(n,1);let r=new Ae(new De(e,e),n);r.visible=!1;let i=[0,0,0];return{mesh:r,showHalo(e,t){let{uniforms:r}=n;r.halo.value=e,r.haloShares.value.fromArray(Fn(e===null?0:t,i))},setFade(e){eo(n,e)},dispose(){n.dispose(),r.geometry.dispose()}}}export{mt as A,tt as B,Lt as C,I as D,Nt as E,Re as F,He as H,Le as I,Qe as L,at as M,rt as N,jt as O,nt as P,Ze as R,Vt as S,It as T,Ye as U,Be as V,qe as W,jn as _,Xa as a,R as b,Za as c,$n as d,cr as f,Mn as g,W as h,eo as i,it as j,Mt as k,fa as l,Kn as m,io as n,Ya as o,Vn as p,$a as r,Qa as s,to as t,Ga as u,Nn as v,Pt as w,Ht as x,Ut as y,Xe as z};