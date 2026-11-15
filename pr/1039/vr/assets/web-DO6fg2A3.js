import{i as e,n as t,o as n,r,t as i}from"./livekit-client.esm-DF9Z1_Mm.js";var a=class{queue=[];outgoingQueue=[];disconnectionDetails=null;onDisconnectCallback=null;onMessageCallback=null;onModeChangeCallback=null;onDebug;onOutgoingMessageCallback=null;constructor(e={}){this.onDebug=e.onDebug}debug(e){this.onDebug&&this.onDebug(e)}onMessage(e){this.onMessageCallback=e;let t=this.queue;this.queue=[],t.length>0&&queueMicrotask(()=>{t.forEach(e)})}onDisconnect(e){this.onDisconnectCallback=e;let t=this.disconnectionDetails;t&&queueMicrotask(()=>{e(t)})}onModeChange(e){this.onModeChangeCallback=e}onOutgoingMessage(e){this.onOutgoingMessageCallback=e;let t=this.outgoingQueue;this.outgoingQueue=[],t.length>0&&queueMicrotask(()=>{t.forEach(e)})}updateMode(e){this.onModeChangeCallback?.(e)}disconnect(e){this.disconnectionDetails||(this.disconnectionDetails=e,this.onDisconnectCallback?.(e))}handleMessage(e){this.onMessageCallback?this.onMessageCallback(e):this.queue.push(e)}handleOutgoingMessage(e){this.onOutgoingMessageCallback?this.onOutgoingMessageCallback(e):this.outgoingQueue.push(e)}};function o(e){let[t,n]=e.split(`_`);if(![`pcm`,`ulaw`].includes(t))throw Error(`Invalid format: ${e}`);let r=Number.parseInt(n);if(Number.isNaN(r))throw Error(`Invalid sample rate: ${n}`);return{format:t,sampleRate:r}}function s(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function c(e,t=`Expected a JSON object`){if(!s(e))throw Error(t)}async function l(e){try{let t=await e.json();if(!s(t))return e.statusText||`Unknown error`;let n=t.detail,r=s(n)?n.message:n;if(typeof r==`string`)return r}catch(e){console.warn(`Failed to parse API error response as JSON:`,e)}return e.statusText||`Unknown error`}var u=class extends Error{closeCode;closeReason;constructor(e,t){super(e),this.name=`SessionConnectionError`,this.closeCode=t?.closeCode,this.closeReason=t?.closeReason}},d=Object.freeze({name:`js_sdk`,version:`1.24.0`});function f(e){return!!e.type}var p=`conversation_initiation_client_data`;function m(e){let t={type:p};return e.overrides&&(t.conversation_config_override={agent:{prompt:e.overrides.agent?.prompt,first_message:e.overrides.agent?.firstMessage,language:e.overrides.agent?.language},tts:{voice_id:e.overrides.tts?.voiceId,speed:e.overrides.tts?.speed,stability:e.overrides.tts?.stability,similarity_boost:e.overrides.tts?.similarityBoost},...e.overrides.asr?.keywords===void 0?{}:{asr:{keywords:e.overrides.asr.keywords}},conversation:{text_only:e.overrides.conversation?.textOnly}}),e.customLlmExtraBody&&(t.custom_llm_extra_body=e.customLlmExtraBody),e.dynamicVariables&&(t.dynamic_variables=e.dynamicVariables),e.userId&&(t.user_id=e.userId),t.source_info={source:d.name,version:d.version},e.toolMockConfig&&(t.tool_mock_config={mocking_strategy:e.toolMockConfig.mockingStrategy,mocked_tool_names:e.toolMockConfig.mockedToolNames,fallback_strategy:e.toolMockConfig.fallbackStrategy}),t}function h(e){let t=new Uint8Array(e);return btoa(String.fromCharCode(...t))}function g(e){let t=atob(e),n=t.length,r=new Uint8Array(n);for(let e=0;e<n;e++)r[e]=t.charCodeAt(e);return r.buffer}var _={getVolume:()=>0,getByteFrequencyData:()=>{}},ee=8e3;function v(e,t,n){let r=e.length,i=n/2/r,a=Math.floor(100/i),o=Math.min(Math.ceil(ee/i),r),s=o-a,c=t.length;for(let n=0;n<c;n++){let r=n/c*s,i=a+Math.floor(r),l=Math.min(i+1,o-1),u=r-Math.floor(r);t[n]=Math.round(e[i]*(1-u)+e[l]*u)}}var y;function te(e){y=e}function ne(){return y?.()??null}var re=`wss://livekit.rtc.elevenlabs.io`,ie=`https://api.elevenlabs.io`,ae=.01;function oe(e){return e.replace(/^wss:\/\//,`https://`)}var b=class c extends a{conversationId;inputFormat;outputFormat;room;isConnected=!1;audioEventId=1;outputDeviceId=null;audioAdapter;workletPaths;inputAnalyser=void 0;inputVolumeProvider=_;outputAnalyser=void 0;outputVolumeProvider=_;_isMuted=!1;input={close:async()=>{if(this.isConnected)try{this.room.localParticipant.audioTrackPublications.forEach(e=>{e.track&&e.track.stop()})}catch(e){console.warn(`Error stopping local tracks:`,e)}},setDevice:async e=>{if(e?.sampleRate!==void 0||e?.format!==void 0||e?.preferHeadphonesForIosDevices!==void 0)throw Error(`WebRTC input device does not support sampleRate, format, or preferHeadphonesForIosDevices options`);let t=e?.inputDeviceId;t&&await this.setAudioInputDevice(t)},setMuted:async t=>{if(!this.isConnected||!this.room.localParticipant){console.warn(`Cannot set microphone muted: room not connected or no local participant`);return}this._isMuted=t;let n=this.room.localParticipant.getTrackPublication(e.Source.Microphone);if(n?.track)try{t?await n.track.mute():await n.track.unmute()}catch{await this.room.localParticipant.setMicrophoneEnabled(!t)}else await this.room.localParticipant.setMicrophoneEnabled(!t);if(!t){let t=this.room.localParticipant.getTrackPublication(e.Source.Microphone)?.track;t&&this.setupInputAnalyser(t.mediaStreamTrack)}},isMuted:()=>this._isMuted,getAnalyser:()=>this.inputAnalyser,getVolume:()=>this._isMuted?0:this.inputVolumeProvider.getVolume(),getByteFrequencyData:e=>{this._isMuted?e.fill(0):this.inputVolumeProvider.getByteFrequencyData(e)}};output={close:async()=>{},setDevice:async e=>{if(e?.sampleRate!==void 0||e?.format!==void 0)throw Error(`WebRTC output device does not support sampleRate or format options`);let t=e?.outputDeviceId;t&&await this.setAudioOutputDevice(t)},setVolume:e=>{this.setAudioVolume(e)},interrupt:e=>{},getAnalyser:()=>this.outputAnalyser,getVolume:()=>this.outputVolumeProvider.getVolume(),getByteFrequencyData:e=>{this.outputVolumeProvider.getByteFrequencyData(e)}};constructor(e,t,n,r,i={}){super(i),this.room=e,this.conversationId=t,this.inputFormat=n,this.outputFormat=r,this.audioAdapter=ne(),this.workletPaths=i.workletPaths,this.setupRoomEventListeners()}static async create(n){let i;if(`conversationToken`in n&&n.conversationToken)i=n.conversationToken;else if(`agentId`in n&&n.agentId)try{let{name:e,version:t}=d,r=`${oe(n.origin??ie)}/v1/convai/conversation/token?agent_id=${n.agentId}&source=${e}&version=${t}`;n.environment&&(r+=`&environment=${encodeURIComponent(n.environment)}`);let a=await fetch(r);if(!a.ok){let e=await l(a);throw Error(`ElevenLabs API returned ${a.status} ${e}`)}let o=await a.json();if(!s(o)||typeof o.token!=`string`||(i=o.token,!i))throw Error(`No conversation token received from API`)}catch(e){let t=e instanceof Error?e.message:String(e);throw e instanceof Error&&e.message.includes(`401`)&&(t=`Your agent has authentication enabled, but no signed URL or conversation token was provided.`),Error(`Failed to fetch conversation token for agent ${n.agentId}: ${t}`)}else throw Error(`Either conversationToken or agentId is required for WebRTC connection`);let a=n.webRtc?.singlePeerConnection,u=new t(a===void 0?void 0:{singlePeerConnection:a});try{let t=`room_${Date.now()}`,a=o(`pcm_48000`),s=o(`pcm_48000`),l=new c(u,t,a,s,n),d=n.livekitUrl||re,f=n.textOnly?Promise.resolve():new Promise((e,t)=>{u.once(r.SignalConnected,()=>{l.enableMicrophone(n.inputDeviceId).then(()=>e()).catch(t)})}),h=n.webRtc?.iceTransportPolicy;await u.connect(d,i,{rtcConfig:h?{iceTransportPolicy:h}:void 0}),await new Promise(e=>{if(l.isConnected)e();else{let t=()=>{u.off(r.Connected,t),e()};u.on(r.Connected,t)}}),await f;let g=u.localParticipant.getTrackPublication(e.Source.Microphone)?.track;g&&l.setupInputAnalyser(g.mediaStreamTrack),u.name&&(l.conversationId=u.name.match(/(conv_[a-zA-Z0-9]+)/)?.[0]||u.name);let _=m(n);return l.debug({type:p,message:_}),await l.sendRequiredMessage(_),l}catch(e){throw await u.disconnect(),e}}setupRoomEventListeners(){this.room.on(r.Connected,()=>{this.isConnected=!0}),this.room.on(r.Disconnected,e=>{this.isConnected=!1,this.disconnect({reason:`agent`,context:{type:`close`,reason:e?.toString()}})}),this.room.on(r.ConnectionStateChanged,e=>{e===i.Disconnected&&(this.isConnected=!1,this.disconnect({reason:`error`,message:`LiveKit connection state changed to ${e}`,context:{type:`connection_state_changed`}}))}),this.room.on(r.DataReceived,(e,t)=>{try{let t=JSON.parse(new TextDecoder().decode(e));if(t.type===`audio`){f(t)&&this.handleMessage(t);return}f(t)?this.handleMessage(t):console.warn(`Invalid socket event received:`,t)}catch(t){console.warn(`Failed to parse incoming data message:`,t),console.warn(`Raw payload:`,new TextDecoder().decode(e))}}),this.room.on(r.TrackSubscribed,async(t,n,r)=>{if(t.kind===e.Kind.Audio&&r.identity.includes(`agent`)){let e=t;this.audioAdapter&&(await this.audioAdapter.attachRemoteTrack(e,this.outputDeviceId),await this.setupAudioCapture(e),this.onDebug?.({type:`audio_element_ready`}))}}),this.room.on(r.ActiveSpeakersChanged,async e=>{e.length>0?this.updateMode(e[0].identity.startsWith(`agent`)?`speaking`:`listening`):this.updateMode(`listening`)}),this.room.on(r.ParticipantDisconnected,e=>{e.identity?.startsWith(`agent`)&&this.disconnect({reason:`agent`,context:{type:`close`,reason:`agent disconnected`}})})}close(){if(this.isConnected){try{this.room.localParticipant.audioTrackPublications.forEach(e=>{e.track&&e.track.stop()})}catch(e){console.warn(`Error stopping local tracks:`,e)}this.audioAdapter?.cleanup(),this.inputAnalyser=void 0,this.outputAnalyser=void 0,this.inputVolumeProvider=_,this.outputVolumeProvider=_,this.room.disconnect()}}async sendMessage(e){if(!this.isConnected||!this.room.localParticipant)console.warn(`Cannot send message: room not connected or no local participant`);else if(!(`user_audio_chunk`in e)){this.handleOutgoingMessage(e);try{await this.publishMessage(e)}catch(t){this.debug({type:`send_message_error`,message:{message:e,error:t}}),console.error(`Failed to send message via WebRTC:`,t)}}}async sendRequiredMessage(e){if(!this.isConnected||!this.room.localParticipant)throw Error(`Cannot send message: room not connected or no local participant`);this.handleOutgoingMessage(e),await this.publishMessage(e)}async publishMessage(e){let t=new TextEncoder().encode(JSON.stringify(e));await this.room.localParticipant.publishData(t,{reliable:!0})}getRoom(){return this.room}setupInputAnalyser(e){if(this.audioAdapter)try{let t=this.audioAdapter.setupInputAnalysis(e);this.inputVolumeProvider=t.volumeProvider,this.inputAnalyser=t.analyser}catch(e){console.warn(`[ConversationalAI] Failed to set up input volume analyser:`,e)}}setInputVolumeProvider(e){this.inputVolumeProvider=e}setOutputVolumeProvider(e){this.outputVolumeProvider=e}async setupAudioCapture(e){if(this.audioAdapter)try{let t=await this.audioAdapter.setupOutputAnalysis(e,this.outputFormat,(e,t)=>{if(t>ae){let t=h(e),n=this.audioEventId++;this.handleMessage({type:`audio`,audio_event:{audio_base_64:t,event_id:n}})}},this.workletPaths);this.outputVolumeProvider=t.volumeProvider,this.outputAnalyser=t.analyser}catch(e){console.warn(`Failed to set up audio capture:`,e)}}setAudioVolume(e){this.audioAdapter?.setVolume(e)}async setAudioOutputDevice(e){if(!this.audioAdapter)throw Error(`Cannot set output device: no audio adapter available on this platform`);await this.audioAdapter.setOutputDevice(e),this.outputDeviceId=e}async setAudioInputDevice(t){if(!this.isConnected||!this.room.localParticipant)throw Error(`Cannot change input device: room not connected or no local participant`);let n=await this.createMicrophoneTrack(t);try{let t=this.room.localParticipant.getTrackPublication(e.Source.Microphone);t?.track&&await this.room.localParticipant.unpublishTrack(t.track),this._isMuted&&await n.mute(),await this.room.localParticipant.publishTrack(n,{name:`microphone`,source:e.Source.Microphone})}catch(t){console.error(`Failed to change input device:`,t);let r=this.room.localParticipant.getTrackPublication(e.Source.Microphone);if(r?.track!==n&&n.stop(),!r?.track)try{await this.room.localParticipant.setMicrophoneEnabled(!this._isMuted);let t=this.room.localParticipant.getTrackPublication(e.Source.Microphone)?.track;t&&this.setupInputAnalyser(t.mediaStreamTrack)}catch(e){console.error(`Failed to recover microphone after device switch error:`,e)}throw t}this.setupInputAnalyser(n.mediaStreamTrack)}async enableMicrophone(t){if(!t){await this.room.localParticipant.setMicrophoneEnabled(!0);return}let n=await this.createMicrophoneTrack(t);try{await this.room.localParticipant.publishTrack(n,{name:`microphone`,source:e.Source.Microphone})}catch(e){throw n.stop(),e}}createMicrophoneTrack(e){return n({deviceId:{exact:e},echoCancellation:!0,noiseSuppression:!0,autoGainControl:!0,channelCount:{ideal:1}})}},se=`Import the platform-specific entry point (e.g. @elevenlabs/client via the "browser" export).`;function x(e){return Error(`No ${e} registered. ${se}`)}var S;function ce(e){S=e}function le(){if(S)return S;throw x(`voice session setup strategy`)}function ue(e){if(!(e instanceof b))throw Error(`setupWebRTCSession requires a WebRTCConnection. Received: ${e?.constructor?.name??typeof e}`);return{connection:e,input:e.input,output:e.output,playbackEventTarget:null,detach:async()=>{}}}var C=new Map;function de(e,t){return t?`${e} ${t}`:e}function w(e,t){return async(n,r)=>{let i=de(e,r),a=C.get(i);if(a)return n.addModule(a);if(r)try{await n.addModule(r),C.set(i,r);return}catch(t){throw Error(`Failed to load the ${e} worklet module from path: ${r}. Error: ${t}`)}let o=new Blob([t],{type:`application/javascript`}),s=URL.createObjectURL(o);try{await n.addModule(s),C.set(i,s);return}catch{URL.revokeObjectURL(s)}try{let e=`data:application/javascript;base64,${btoa(t)}`;await n.addModule(e),C.set(i,e)}catch{throw Error(`Failed to load the ${e} worklet module. Make sure the browser supports AudioWorklets. If you are using a strict CSP, you may need to self-host the worklet files.`)}}}var fe=w(`audioConcatProcessor`,`/*
 * ulaw decoding logic taken from the wavefile library
 * https://github.com/rochars/wavefile/blob/master/lib/codecs/mulaw.js
 * USED BY @elevenlabs/client
 */

const decodeTable = [0, 132, 396, 924, 1980, 4092, 8316, 16764];

function decodeSample(muLawSample) {
  let sign;
  let exponent;
  let mantissa;
  let sample;
  muLawSample = ~muLawSample;
  sign = muLawSample & 0x80;
  exponent = (muLawSample >> 4) & 0x07;
  mantissa = muLawSample & 0x0f;
  sample = decodeTable[exponent] + (mantissa << (exponent + 3));
  if (sign !== 0) sample = -sample;

  return sample;
}

class AudioConcatProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = []; // Initialize an empty buffer
    this.cursor = 0;
    this.currentBuffer = null;
    this.wasInterrupted = false;
    this.finished = false;

    this.port.onmessage = ({ data }) => {
      switch (data.type) {
        case "setFormat":
          this.format = data.format;
          if (globalThis.LibSampleRate && sampleRate !== data.sampleRate) {
            globalThis.LibSampleRate.create(
              1,
              data.sampleRate,
              sampleRate
            ).then(resampler => {
              this.resampler = resampler;
            });
          }
          break;
        case "buffer":
          this.wasInterrupted = false;
          this.buffers.push(
            this.format === "ulaw"
              ? new Uint8Array(data.buffer)
              : new Int16Array(data.buffer)
          );
          break;
        case "interrupt":
          this.wasInterrupted = true;
          break;
        case "clearInterrupted":
          if (this.wasInterrupted) {
            this.wasInterrupted = false;
            this.buffers = [];
            this.currentBuffer = null;
          }
      }
    };
  }
  process(_, outputs) {
    let finished = false;
    const output = outputs[0][0];
    for (let i = 0; i < output.length; i++) {
      if (!this.currentBuffer) {
        if (this.buffers.length === 0) {
          finished = true;
          break;
        }
        this.currentBuffer = this.buffers.shift();
        if (this.resampler) {
          this.currentBuffer = this.resampler.full(this.currentBuffer);
        }
        this.cursor = 0;
      }

      let value = this.currentBuffer[this.cursor];
      if (this.format === "ulaw") {
        value = decodeSample(value);
      }
      output[i] = value / 32768;
      this.cursor++;

      if (this.cursor >= this.currentBuffer.length) {
        this.currentBuffer = null;
      }
    }

    if (this.finished !== finished) {
      this.finished = finished;
      this.port.postMessage({ type: "process", finished });
    }

    return true; // Continue processing
  }
}

registerProcessor("audioConcatProcessor", AudioConcatProcessor);
`),pe=`https://cdn.jsdelivr.net/npm/@alexanderolsen/libsamplerate-js@2.1.2/dist/libsamplerate.worklet.js`;async function T(e,t){let n=t||pe;await e.audioWorklet.addModule(n)}function me(e){if(e.length===0)return 0;let t=0;for(let n=0;n<e.length;n++)t+=e[n]/255;return t/=e.length,t<0?0:t>1?1:t}function E(e,t){let n=e.frequencyBinCount,r,i;return{getVolume(){return r??=new Uint8Array(n),i??=new Uint8Array(n),e.getByteFrequencyData(r),v(r,i,t),me(i)},getByteFrequencyData(i){r??=new Uint8Array(n),e.getByteFrequencyData(r),v(r,i,t)}}}function D(){return[`iPad Simulator`,`iPhone Simulator`,`iPod Simulator`,`iPad`,`iPhone`,`iPod`].includes(navigator.platform)||navigator.userAgent.includes(`Mac`)&&`ontouchend`in document}function he(){return/android/i.test(navigator.userAgent)}function ge({sampleRate:e,format:t,worklet:n,audioElement:r}){if(!D())return;let i=Math.floor(e*100/1e3),a=t===`ulaw`?new Uint8Array(i).fill(255):new Int16Array(i);n.port.postMessage({type:`buffer`,buffer:a.buffer}),r.play().catch(()=>{})}var _e=class e{context;analyser;gain;worklet;audioElement;static async create({sampleRate:t,format:n,outputDeviceId:r,workletPaths:i,libsampleratePath:a,audioContext:o}){let s=o??null,c=null;try{let o=navigator.mediaDevices.getSupportedConstraints().sampleRate;s||=new AudioContext(o?{sampleRate:t}:{});let l=s.createAnalyser(),u=s.createGain();c=new Audio,c.src=``,c.load(),c.autoplay=!0,c.style.display=`none`,document.body.appendChild(c);let d=s.createMediaStreamDestination();c.srcObject=d.stream,u.connect(l),l.connect(d),(!o||s.sampleRate!==t)&&(s.sampleRate!==t&&console.warn(`[ConversationalAI] Sample rate ${t} not available, resampling to ${s.sampleRate}`),await T(s,a)),await fe(s.audioWorklet,i?.audioConcatProcessor);let f=new AudioWorkletNode(s,`audioConcatProcessor`);return f.port.postMessage({type:`setFormat`,format:n,sampleRate:t}),f.connect(u),await s.resume(),ge({sampleRate:t,format:n,worklet:f,audioElement:c}),r&&c.setSinkId&&await c.setSinkId(r),new e(s,l,u,f,c)}catch(e){throw c?.parentNode&&c.parentNode.removeChild(c),c?.pause(),s&&s.state!==`closed`&&await s.close(),e}}volume=1;interrupted=!1;interruptTimeout=null;volumeProvider;constructor(e,t,n,r,i){this.context=e,this.analyser=t,this.gain=n,this.worklet=r,this.audioElement=i,this.worklet.port.start(),this.volumeProvider=E(t,e.sampleRate)}getAnalyser(){return this.analyser}getVolume(){return this.volumeProvider.getVolume()}getByteFrequencyData(e){this.volumeProvider.getByteFrequencyData(e)}addListener(e){this.worklet.port.addEventListener(`message`,e)}removeListener(e){this.worklet.port.removeEventListener(`message`,e)}setVolume(e){this.volume=e,this.gain.gain.value=e}playAudio(e){this.gain.gain.cancelScheduledValues(this.context.currentTime),this.gain.gain.value=this.volume,this.interruptTimeout&&=(clearTimeout(this.interruptTimeout),null),this.worklet.port.postMessage({type:`clearInterrupted`}),this.worklet.port.postMessage({type:`buffer`,buffer:e})}interrupt(e=2e3){this.interrupted=!0,this.interruptTimeout&&=(clearTimeout(this.interruptTimeout),null),this.worklet.port.postMessage({type:`interrupt`}),this.gain.gain.exponentialRampToValueAtTime(1e-4,this.context.currentTime+e/1e3),this.interruptTimeout=setTimeout(()=>{this.interrupted=!1,this.gain.gain.value=this.volume,this.worklet.port.postMessage({type:`clearInterrupted`}),this.interruptTimeout=null},e)}async setDevice(e){if(!(`setSinkId`in HTMLAudioElement.prototype))throw Error(`setSinkId is not supported in this browser`);let t=e?.outputDeviceId;await this.audioElement.setSinkId(t||``)}async close(){this.interruptTimeout&&=(clearTimeout(this.interruptTimeout),null),this.audioElement.parentNode&&this.audioElement.parentNode.removeChild(this.audioElement),this.audioElement.pause(),await this.context.close()}},O=w(`rawAudioProcessor`,`/*
 * ulaw encoding logic taken from the wavefile library
 * https://github.com/rochars/wavefile/blob/master/lib/codecs/mulaw.js
 * USED BY @elevenlabs/client
 */

const BIAS = 0x84;
const CLIP = 32635;
const encodeTable = [
  0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,
  4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
  5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
  5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7
];

function encodeSample(sample) {
  let sign;
  let exponent;
  let mantissa;
  let muLawSample;
  sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  sample = sample + BIAS;
  if (sample > CLIP) sample = CLIP;
  exponent = encodeTable[(sample>>7) & 0xFF];
  mantissa = (sample >> (exponent+3)) & 0x0F;
  muLawSample = ~(sign | (exponent << 4) | mantissa);
  
  return muLawSample;
}

class RawAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
              
    this.port.onmessage = ({ data }) => {
      switch (data.type) {
        case "setFormat":
          this.isMuted = false;
          this.buffer = []; // Initialize an empty buffer
          const chunkDurationMs = data.chunkDurationMs ?? 25;
          this.bufferSize = Math.max(
            1,
            Math.round((data.sampleRate * chunkDurationMs) / 1000)
          );
          this.format = data.format;

          if (globalThis.LibSampleRate && sampleRate !== data.sampleRate) {
            globalThis.LibSampleRate.create(1, sampleRate, data.sampleRate).then(resampler => {
              this.resampler = resampler;
            });
          }
          break;
        case "setMuted":
          this.isMuted = data.isMuted;
          break;
      }
    };
  }
  process(inputs) {
    if (!this.buffer) {
      return true;
    }
    
    const input = inputs[0]; // Get the first input node
    if (input.length > 0) {
      let channelData = input[0]; // Get the first channel's data

      // Resample the audio if necessary
      if (this.resampler) {
        channelData = this.resampler.full(channelData);
      }

      // Add channel data to the buffer
      this.buffer.push(...channelData);
      // Get max volume 
      let sum = 0.0;
      for (let i = 0; i < channelData.length; i++) {
        sum += channelData[i] * channelData[i];
      }
      const maxVolume = Math.sqrt(sum / channelData.length);
      // Check if buffer size has reached or exceeded the threshold
      if (this.buffer.length >= this.bufferSize) {
        const float32Array = this.isMuted 
          ? new Float32Array(this.buffer.length)
          : new Float32Array(this.buffer);

        let encodedArray = this.format === "ulaw"
          ? new Uint8Array(float32Array.length)
          : new Int16Array(float32Array.length);

        // Iterate through the Float32Array and convert each sample to PCM16
        for (let i = 0; i < float32Array.length; i++) {
          // Clamp the value to the range [-1, 1]
          let sample = Math.max(-1, Math.min(1, float32Array[i]));

          // Scale the sample to the range [-32768, 32767]
          let value = sample < 0 ? sample * 32768 : sample * 32767;
          if (this.format === "ulaw") {
            value = encodeSample(Math.round(value));
          }

          encodedArray[i] = value;
        }

        // Send the buffered data to the main script
        this.port.postMessage([encodedArray, maxVolume]);

        // Clear the buffer after sending
        this.buffer = [];
      }
    }
    return true; // Continue processing
  }
}
registerProcessor("rawAudioProcessor", RawAudioProcessor);
`),ve=25,k={echoCancellation:!0,noiseSuppression:!0,autoGainControl:!0,channelCount:{ideal:1}},ye=class e{context;analyser;worklet;inputStream;mediaStreamSource;permissions;onError;static async create({sampleRate:t,format:n,preferHeadphonesForIosDevices:r,inputDeviceId:i,workletPaths:a,libsampleratePath:o,onError:s,inputChunkDurationMs:c=25}){let l=null,u=null;try{let d={sampleRate:{ideal:t},...k};if(D()&&r){let e=(await window.navigator.mediaDevices.enumerateDevices()).find(e=>e.kind===`audioinput`&&[`airpod`,`headphone`,`earphone`].find(t=>e.label.toLowerCase().includes(t)));e&&(d.deviceId={ideal:e.deviceId})}i&&(d.deviceId=e.getDeviceIdConstraint(i));let f=navigator.mediaDevices.getSupportedConstraints().sampleRate;l=new window.AudioContext(f?{sampleRate:t}:{});let p=l.createAnalyser();f||await T(l,o),await O(l.audioWorklet,a?.rawAudioProcessor);let m={voiceIsolation:!0,...d};u=await navigator.mediaDevices.getUserMedia({audio:m});let h=l.createMediaStreamSource(u),g=new AudioWorkletNode(l,`rawAudioProcessor`);g.port.postMessage({type:`setFormat`,format:n,sampleRate:t,chunkDurationMs:c}),h.connect(p),p.connect(g),await l.resume();let _=await navigator.permissions.query({name:`microphone`});return new e(l,p,g,u,h,_,s)}catch(e){throw u?.getTracks().forEach(e=>{e.stop()}),l?.close(),e}}static getDeviceIdConstraint(e){if(e)return D()?{ideal:e}:{exact:e}}muted=!1;volumeProvider;constructor(e,t,n,r,i,a,o=console.error){this.context=e,this.analyser=t,this.worklet=n,this.inputStream=r,this.mediaStreamSource=i,this.permissions=a,this.onError=o,this.permissions.addEventListener(`change`,this.handlePermissionsChange),this.worklet.port.start(),this.volumeProvider=E(t,e.sampleRate)}getAnalyser(){return this.analyser}getVolume(){return this.muted?0:this.volumeProvider.getVolume()}getByteFrequencyData(e){this.muted?e.fill(0):this.volumeProvider.getByteFrequencyData(e)}isMuted(){return this.muted}addListener(e){this.worklet.port.addEventListener(`message`,e)}removeListener(e){this.worklet.port.removeEventListener(`message`,e)}forgetInputStreamAndSource(){for(let e of this.inputStream.getTracks())e.stop();this.mediaStreamSource.disconnect()}async close(){this.forgetInputStreamAndSource(),this.permissions.removeEventListener(`change`,this.handlePermissionsChange),await this.context.close()}async setMuted(e){this.muted=e,this.worklet.port.postMessage({type:`setMuted`,isMuted:e})}settingInput=!1;async setDevice(t){try{if(this.settingInput)throw Error(`Input device is already being set`);this.settingInput=!0;let n=t?.inputDeviceId,r={...k};n&&(r.deviceId=e.getDeviceIdConstraint(n));let i={voiceIsolation:!0,...r},a=await navigator.mediaDevices.getUserMedia({audio:i});this.forgetInputStreamAndSource(),this.inputStream=a,this.mediaStreamSource=this.context.createMediaStreamSource(a),this.mediaStreamSource.connect(this.analyser)}catch(e){throw this.onError(`Failed to switch input device:`,e),e}finally{this.settingInput=!1}}handlePermissionsChange=()=>{if(this.permissions.state===`denied`)this.onError(`Microphone permission denied`);else if(!this.settingInput){let[e]=this.inputStream.getAudioTracks(),{deviceId:t}=e?.getSettings()??{};this.setDevice({inputDeviceId:t}).catch(e=>{this.onError(`Failed to reset input device after permission change:`,e)})}}},be=`enclave_setup_config`;function A(e){return{url:e.url,...e.hmacSecret===void 0?{}:{hmac_secret:e.hmacSecret}}}function xe(e){let t={type:be,agent_config_dict:e.agentConfig??null,override_agent_config_list:e.agentConfigOverrides??null,tools_config_list:e.tools??null,prompt_knowledge_base:e.promptKnowledgeBase??null};return e.bedrockInferenceProfile!==void 0&&(t.bedrock_inference_profile=e.bedrockInferenceProfile),e.postCallTranscriptionWebhook&&(t.post_call_transcription_webhook=A(e.postCallTranscriptionWebhook)),e.postCallAudioWebhook&&(t.post_call_audio_webhook=A(e.postCallAudioWebhook)),t}var Se=`convai`,Ce=`wss://api.elevenlabs.io`,we=`/v1/convai/conversation?agent_id=`,j=class e extends a{socket;conversationId;inputFormat;outputFormat;outputListeners=new Set;pendingAudioEvents=[];constructor(e,t,n,r){super(),this.socket=e,this.conversationId=t,this.inputFormat=n,this.outputFormat=r,this.socket.addEventListener(`error`,e=>{setTimeout(()=>this.disconnect({reason:`error`,message:`The connection was closed due to a socket error.`,context:{type:e.type}}),0)}),this.socket.addEventListener(`close`,e=>{let t=e.code,n=e.reason||void 0,r={type:e.type,code:t,reason:n};this.disconnect(t===1e3?{reason:`agent`,context:r,closeCode:t,closeReason:n}:{reason:`error`,message:n||`The connection was closed by the server.`,context:r,closeCode:t,closeReason:n})}),this.socket.addEventListener(`message`,e=>{try{let t=JSON.parse(e.data);if(!f(t)){this.debug({type:`invalid_event`,message:`Received invalid socket event`,data:e.data});return}this.handleMessage(t)}catch(t){this.debug({type:`parsing_error`,message:`Failed to parse socket message`,error:t instanceof Error?t.message:String(t),data:e.data})}})}static async create(t){let n=null;try{let r,i,{name:a,version:s}=d;if(t.orchestrator)r=t.orchestrator.url;else{let e=t.origin??Ce;if(t.signedUrl){let e=t.signedUrl.includes(`?`)?`&`:`?`;r=`${t.signedUrl}${e}source=${a}&version=${s}`}else r=`${e}${we}${t.agentId}&source=${a}&version=${s}`;t.environment&&(r+=`&environment=${encodeURIComponent(t.environment)}`),i=[Se],t.authorization&&i.push(`bearer.${t.authorization}`)}n=new WebSocket(r,i);let{conversation_id:c,agent_output_audio_format:l,user_input_audio_format:p}=await new Promise((e,r)=>{n.addEventListener(`open`,()=>{t.orchestrator&&n?.send(JSON.stringify(xe(t.orchestrator)));let e=m(t);n?.send(JSON.stringify(e))},{once:!0}),n.addEventListener(`error`,e=>{setTimeout(()=>r(new u(`The connection was closed due to a socket error.`)),0)}),n.addEventListener(`close`,e=>{r(new u(e.reason||(e.code===1e3?`Connection closed normally before session could be established.`:`Connection closed unexpectedly before session could be established.`),{closeCode:e.code,closeReason:e.reason||void 0}))}),n.addEventListener(`message`,t=>{let n=JSON.parse(t.data);f(n)&&(n.type===`conversation_initiation_metadata`?e(n.conversation_initiation_metadata_event):console.warn(`First received message is not conversation metadata.`))},{once:!0})}),h=o(p??`pcm_16000`),g=o(l);return new e(n,c,h,g)}catch(e){throw n?.close(),e}}close(){this.pendingAudioEvents=[],this.socket.close(1e3,`User ended conversation`)}sendMessage(e){this.handleOutgoingMessage(e),this.socket.send(JSON.stringify(e))}addListener(e){let t=this.outputListeners.size>0;if(this.outputListeners.add(e),t||this.pendingAudioEvents.length===0)return;let n=this.pendingAudioEvents;this.pendingAudioEvents=[];for(let t of n)e(t)}removeListener(e){this.outputListeners.delete(e)}handleMessage(e){if(super.handleMessage(e),e.type===`audio`&&e.audio_event.audio_base_64){let t={audio_base_64:e.audio_event.audio_base_64};if(this.outputListeners.size===0){this.pendingAudioEvents.push(t);return}this.outputListeners.forEach(e=>e(t))}}};function Te(e,t){let n=e=>{let n=e.data[0];t.sendMessage({user_audio_chunk:h(n.buffer)})};return e.addListener(n),()=>{e.removeListener(n)}}function Ee(e,t){let n=e=>{t.playAudio(g(e.audio_base_64))};return e.addListener(n),()=>{e.removeListener(n)}}function De(e){let t=`signedUrl`in e&&e.signedUrl,n=`orchestrator`in e&&e.orchestrator;if(t&&e.connectionType===`webrtc`)throw Error(`signedUrl only supports websocket connections. Remove connectionType or set it to 'websocket'.`);if(n&&e.connectionType===`webrtc`)throw Error(`Orchestrator sessions only support websocket connections. Remove connectionType or set it to 'websocket'.`);if(n&&(t||`conversationToken`in e&&e.conversationToken||e.authorization))throw Error(`The orchestrator option cannot be combined with signedUrl, conversationToken or authorization.`);return e.connectionType?e.connectionType:`conversationToken`in e&&e.conversationToken?`webrtc`:t||n||e.textOnly?`websocket`:`webrtc`}async function M(e){let t=De(e);switch(t){case`websocket`:return j.create(e);case`webrtc`:return b.create(e);default:throw Error(`Unknown connection type: ${t}`)}}var Oe={default:0,android:3e3};function N(e,t=`default`){let n=e??Oe;return t===`android`?n.android??n.default:t===`ios`?n.ios??n.default:n.default}async function P(e){e>0&&await new Promise(t=>setTimeout(t,e))}var ke=3e4,Ae=[`touchstart`,`touchend`,`click`],F=null,I=null,L=!1;function je(e){let t=e.createBuffer(1,1,22050),n=e.createBufferSource();n.buffer=t,n.connect(e.destination),n.start(0),e.resume().catch(()=>{})}function Me(){I&&clearTimeout(I),I=setTimeout(()=>{I=null,B()},ke)}function R(){I&&=(clearTimeout(I),null)}function Ne(){if(!D()||F)return;let e=new AudioContext;je(e),F=e,Me()}function Pe(){if(!D()||L||typeof document>`u`)return;L=!0;let e=()=>{Ne()};for(let t of Ae)document.addEventListener(t,e,!0)}function z(){let e=F;return F=null,R(),e}function B(){F&&(F.close().catch(()=>{}),F=null,R())}function Fe(){return he()?`android`:D()?`ios`:`default`}async function V(){if(`wakeLock`in navigator)try{return await navigator.wakeLock.request(`screen`)}catch{}return null}async function Ie(e,t,n){let[r,i]=await Promise.all([ye.create({...t.inputFormat,preferHeadphonesForIosDevices:e.preferHeadphonesForIosDevices,inputDeviceId:e.inputDeviceId,inputChunkDurationMs:e.inputChunkDurationMs,workletPaths:e.workletPaths,libsampleratePath:e.libsampleratePath}),_e.create({...t.outputFormat,outputDeviceId:e.outputDeviceId,workletPaths:e.workletPaths,audioContext:n??void 0})]),a=Te(r,t),o=Ee(t,i);return{input:r,output:i,playbackEventTarget:i,detach:async()=>{a(),o()}}}async function Le(e){let t=e.useWakeLock??!0,n=null,r=null,i=null;try{t&&(n=await V()),r=await navigator.mediaDevices.getUserMedia({audio:!0});let a=Fe();await P(N(e.connectionDelay,a));let o=await M(e),s;try{o instanceof j?(i=z(),s={connection:o,...await Ie(e,o,i)},i=null):(B(),s=ue(o))}catch(e){throw await i?.close().catch(()=>{}),i=null,o.close(),e}if(r){for(let e of r.getTracks())e.stop();r=null}let c=null;n&&(c=()=>{document.visibilityState===`visible`&&n?.released&&V().then(e=>{n=e})},document.addEventListener(`visibilitychange`,c));let l=s.detach;return{...s,detach:async()=>{await l(),c&&document.removeEventListener(`visibilitychange`,c);try{await n?.release(),n=null}catch{}}}}catch(e){if(r)for(let e of r.getTracks())e.stop();try{await n?.release(),n=null}catch{}throw B(),e}}ce(Le);var Re=class{audioElements=[];inputAudioContext=null;audioCaptureContext=null;async attachRemoteTrack(e,t){let n=e.attach();if(n.autoplay=!0,n.controls=!1,t&&n.setSinkId)try{await n.setSinkId(t)}catch(e){console.warn(`Failed to set output device for new audio element:`,e)}n.style.display=`none`,document.body.appendChild(n),this.audioElements.push(n)}setupInputAnalysis(e){this.inputAudioContext&&=(this.inputAudioContext.close().catch(()=>{}),null);let t=new AudioContext,n=t.createAnalyser();return t.createMediaStreamSource(new MediaStream([e])).connect(n),this.inputAudioContext=t,{volumeProvider:E(n,t.sampleRate),analyser:n}}async setupOutputAnalysis(e,t,n,r){this.audioCaptureContext&&=(this.audioCaptureContext.close().catch(()=>{}),null);let i=new AudioContext;this.audioCaptureContext=i;let a=i.createAnalyser();a.fftSize=2048,a.smoothingTimeConstant=.8;let o=new MediaStream([e.mediaStreamTrack]),s=i.createMediaStreamSource(o),c=E(a,i.sampleRate);await O(i.audioWorklet,r?.rawAudioProcessor);let l=new AudioWorkletNode(i,`rawAudioProcessor`);return l.port.postMessage({type:`setFormat`,format:t.format,sampleRate:t.sampleRate}),l.port.onmessage=e=>{let[t,r]=e.data;n(t.buffer,r)},s.connect(a),a.connect(l),{volumeProvider:c,analyser:a}}setVolume(e){for(let t of this.audioElements)t.volume=e}async setOutputDevice(e){if(!(`setSinkId`in HTMLAudioElement.prototype))throw Error(`setSinkId is not supported in this browser`);await Promise.all(this.audioElements.map(async t=>{try{await t.setSinkId(e)}catch(e){throw console.error(`Failed to set sink ID for audio element:`,e),e}}))}cleanup(){this.inputAudioContext&&=(this.inputAudioContext.close().catch(e=>{console.warn(`Error closing input audio context:`,e)}),null),this.audioCaptureContext&&=(this.audioCaptureContext.close().catch(e=>{console.warn(`Error closing audio capture context:`,e)}),null);for(let e of this.audioElements)e.remove();this.audioElements=[]}},H=null;function ze(e){H=e}function Be(){if(!H)throw x(`Scribe microphone implementation`);return H}var Ve=w(`scribeAudioProcessor`,`/*
 * Scribe Audio Processor for converting microphone audio to PCM16 format
 * Supports resampling for browsers like Firefox that don't support
 * AudioContext sample rate constraints.
 * USED BY @elevenlabs/client
 */

class ScribeAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.bufferSize = 4096; // Buffer size for optimal chunk transmission

    // Resampling state
    this.inputSampleRate = null;
    this.outputSampleRate = null;
    this.resampleRatio = 1;
    this.lastSample = 0;
    this.resampleAccumulator = 0;

    this.port.onmessage = ({ data }) => {
      if (data.type === "configure") {
        this.inputSampleRate = data.inputSampleRate;
        this.outputSampleRate = data.outputSampleRate;
        if (this.inputSampleRate && this.outputSampleRate) {
          this.resampleRatio = this.inputSampleRate / this.outputSampleRate;
        }
      }
    };
  }

  // Linear interpolation resampling
  resample(inputData) {
    if (this.resampleRatio === 1 || !this.inputSampleRate) {
      return inputData;
    }

    const outputSamples = [];

    for (let i = 0; i < inputData.length; i++) {
      const currentSample = inputData[i];

      // Generate output samples using linear interpolation
      while (this.resampleAccumulator < 1) {
        const interpolated =
          this.lastSample +
          (currentSample - this.lastSample) * this.resampleAccumulator;
        outputSamples.push(interpolated);
        this.resampleAccumulator += this.resampleRatio;
      }

      this.resampleAccumulator -= 1;
      this.lastSample = currentSample;
    }

    return new Float32Array(outputSamples);
  }

  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      let channelData = input[0]; // Get first channel (mono)

      // Resample if needed (for Firefox and other browsers that don't
      // support AudioContext sample rate constraints)
      if (this.resampleRatio !== 1) {
        channelData = this.resample(channelData);
      }

      // Add incoming audio to buffer
      for (let i = 0; i < channelData.length; i++) {
        this.buffer.push(channelData[i]);
      }

      // When buffer reaches threshold, convert and send
      if (this.buffer.length >= this.bufferSize) {
        const float32Array = new Float32Array(this.buffer);
        const int16Array = new Int16Array(float32Array.length);

        // Convert Float32 [-1, 1] to Int16 [-32768, 32767]
        for (let i = 0; i < float32Array.length; i++) {
          // Clamp the value to prevent overflow
          const sample = Math.max(-1, Math.min(1, float32Array[i]));
          // Scale to PCM16 range
          int16Array[i] = sample < 0 ? sample * 32768 : sample * 32767;
        }

        // Send to main thread as transferable ArrayBuffer
        this.port.postMessage(
          {
            audioData: int16Array.buffer
          },
          [int16Array.buffer]
        );

        // Clear buffer
        this.buffer = [];
      }
    }

    return true; // Continue processing
  }
}

registerProcessor("scribeAudioProcessor", ScribeAudioProcessor);

`),U=16e3,He=async(e,t)=>{let n,r,i,a,o=()=>{for(let e of n?.getTracks()??[])e.stop();i?.disconnect(),a?.disconnect(),r?.close()};try{n=await navigator.mediaDevices.getUserMedia({audio:{deviceId:e.deviceId,echoCancellation:e.echoCancellation??!0,noiseSuppression:e.noiseSuppression??!0,autoGainControl:e.autoGainControl??!0,channelCount:e.channelCount??1,sampleRate:{ideal:U}}});let[s]=n.getAudioTracks(),c=s?.getSettings().sampleRate;return r=new AudioContext(c?{sampleRate:c}:{}),await Ve(r.audioWorklet,e.workletPaths?.scribeAudioProcessor),i=r.createMediaStreamSource(n),a=new AudioWorkletNode(r,`scribeAudioProcessor`),r.sampleRate!==U&&a.port.postMessage({type:`configure`,inputSampleRate:r.sampleRate,outputSampleRate:U}),a.port.onmessage=e=>{t(h(e.data.audioData))},i.connect(a),r.state===`suspended`&&await r.resume(),{mediaStreamTrack:s,cleanup:o}}catch(e){throw o(),e}},Ue=`https://api.elevenlabs.io`;async function We({conversationId:e,origin:t,file:n,filename:r}){let i=(t??Ue).replace(/^wss:\/\//,`https://`).replace(/^ws:\/\//,`http://`),a=r??(`name`in n&&typeof n.name==`string`?n.name:`upload.${(n.type||`image/png`).split(`/`).pop()?.split(`+`)[0]}`),o=new FormData;o.append(`file`,n,a);let s=await fetch(`${i}/v1/convai/conversations/${e}/files`,{method:`POST`,body:o});if(!s.ok){let e=await l(s);throw Error(`Upload failed: ${s.status} ${e}`)}let u=await s.json();c(u,`Upload response is not a JSON object`);let{file_id:d}=u;if(typeof d!=`string`||!d)throw Error(`Upload response is missing a valid file_id`);return{fileId:d}}var W={reason:`agent`,context:{type:`end_call`,reason:`Agent ended the call`}};function G(e){let{textOnly:t}=e.overrides?.conversation??{},{textOnly:n}=e;if(typeof n==`boolean`)return typeof t==`boolean`&&n!==t&&console.warn(`Conflicting textOnly options provided: ${n} via options.textOnly (will be used) and ${t} via options.overrides.conversation.textOnly (will be ignored)`),n;if(typeof t==`boolean`)return t}var K=class{options;connection;lastInterruptTimestamp=0;mode=`listening`;status=`connecting`;volume=1;currentEventId=1;canSendFeedback=!1;mcpApprovals=new Map;static getFullOptions(e){let t=G(e);return{clientTools:{},onConnect:()=>{},onDebug:()=>{},onDisconnect:()=>{},onError:()=>{},onMessage:()=>{},onAudio:()=>{},onModeChange:()=>{},onStatusChange:()=>{},onCanSendFeedbackChange:()=>{},onInterruption:()=>{},onAgentResponseCorrection:()=>{},onAgentTyping:()=>{},onExternalAgentConnected:()=>{},onExternalAgentDisconnected:()=>{},onPing:()=>{},...e,textOnly:t,overrides:{...e.overrides,conversation:{...e.overrides?.conversation,textOnly:t}}}}constructor(e,t){this.options=e,this.connection=t,this.connection.onMessage(this.onMessage),this.connection.onDisconnect(this.endSessionWithDetails),this.connection.onModeChange(e=>this.updateMode(e)),this.connection.onOutgoingMessage(this.onOutgoingMessage)}markConnected(){this.updateStatus(`connected`)}endSession(){return this.endSessionWithDetails({reason:`user`})}endSessionWithDetails=async e=>{if(this.status===`connected`||this.status===`connecting`){this.updateStatus(`disconnecting`);for(let e of this.mcpApprovals.keys())this.markMCPApprovalStale(e);try{await this.handleEndSession()}finally{this.updateStatus(`disconnected`),this.options.onDisconnect&&this.options.onDisconnect(e)}}};async handleEndSession(){this.connection.close()}updateMode(e){e!==this.mode&&(this.mode=e,this.options.onModeChange&&this.options.onModeChange({mode:e}))}updateStatus(e){e!==this.status&&(this.status=e,this.options.onStatusChange&&this.options.onStatusChange({status:e}),this.updateCanSendFeedback())}updateCanSendFeedback(){let e=this.status===`connected`;this.canSendFeedback!==e&&(this.canSendFeedback=e,this.options.onCanSendFeedbackChange&&this.options.onCanSendFeedbackChange({canSendFeedback:e}))}handleInterruption(e){e.interruption_event&&(this.lastInterruptTimestamp=e.interruption_event.event_id,this.options.onInterruption&&this.options.onInterruption({event_id:e.interruption_event.event_id}))}handleAgentResponse(e){this.currentEventId=e.agent_response_event.event_id,this.options.onMessage&&this.options.onMessage({source:`ai`,role:`agent`,message:e.agent_response_event.agent_response,event_id:e.agent_response_event.event_id,attachments:e.agent_response_event.attachments})}handleAgentResponseCorrection(e){this.options.onAgentResponseCorrection&&this.options.onAgentResponseCorrection(e.agent_response_correction_event)}handleUserTranscript(e){this.options.onMessage&&this.options.onMessage({source:`user`,role:`user`,message:e.user_transcription_event.user_transcript,event_id:e.user_transcription_event.event_id})}handleTentativeAgentResponse(e){this.options.onDebug&&this.options.onDebug({type:`tentative_agent_response`,response:e.tentative_agent_response_internal_event.tentative_agent_response})}handleVadScore(e){this.options.onVadScore&&this.options.onVadScore({vadScore:e.vad_score_event.vad_score})}handlePing(e){this.options.onPing&&this.options.onPing(e.ping_event)}handleContextUsage(e){this.options.onContextUsage&&this.options.onContextUsage(e.context_usage_event)}async handleClientToolCall(e){if(Object.prototype.hasOwnProperty.call(this.options.clientTools,e.client_tool_call.tool_name))try{let t=await this.options.clientTools[e.client_tool_call.tool_name](e.client_tool_call.parameters)??`Client tool execution successful.`,n=typeof t==`object`?JSON.stringify(t):String(t);this.connection.sendMessage({type:`client_tool_result`,tool_call_id:e.client_tool_call.tool_call_id,result:n,is_error:!1})}catch(t){this.onError(`Client tool execution failed with following error: ${t?.message}`,{clientToolName:e.client_tool_call.tool_name}),this.connection.sendMessage({type:`client_tool_result`,tool_call_id:e.client_tool_call.tool_call_id,result:`Client tool execution failed: ${t?.message}`,is_error:!0})}else{if(this.options.onUnhandledClientToolCall){this.options.onUnhandledClientToolCall(e.client_tool_call);return}this.onError(`Client tool with name ${e.client_tool_call.tool_name} is not defined on client`,{clientToolName:e.client_tool_call.tool_name}),this.connection.sendMessage({type:`client_tool_result`,tool_call_id:e.client_tool_call.tool_call_id,result:`Client tool with name ${e.client_tool_call.tool_name} is not defined on client`,is_error:!0})}}handleAudio(e){}async handleMCPToolCall(e){let t=e.mcp_tool_call;if(this.options.onMCPToolCall&&this.options.onMCPToolCall(t),t.state!==`awaiting_approval`){this.markMCPApprovalStale(t.tool_call_id);return}let n=this.options.onMCPToolApprovalRequest;if(!n)return;if(this.status===`disconnecting`||this.status===`disconnected`){this.onError(`Ignored an approval request for MCP tool call ${t.tool_call_id}, which arrived after the session ended`,this.mcpApprovalErrorContext(t));return}if(this.mcpApprovals.has(t.tool_call_id)){this.onError(`Ignored a repeated approval request for MCP tool call ${t.tool_call_id}, which has already been handled`,this.mcpApprovalErrorContext(t));return}let r={state:`pending`,controller:new AbortController};this.mcpApprovals.set(t.tool_call_id,r);let i;try{i=await n(t,{signal:r.controller.signal})}catch(e){this.onError(`MCP tool approval handler failed: ${e?.message}`,this.mcpApprovalErrorContext(t)),this.settleMCPApproval(t,!1);return}typeof i==`boolean`?this.settleMCPApproval(t,i):(this.onError(`MCP tool approval handler must resolve to a boolean, received ${typeof i}`,this.mcpApprovalErrorContext(t)),this.settleMCPApproval(t,!1))}settleMCPApproval(e,t){let n=this.mcpApprovals.get(e.tool_call_id);!n||n.state!==`pending`?this.onError(`Discarded an approval decision for MCP tool call ${e.tool_call_id}, which is no longer awaiting approval`,this.mcpApprovalErrorContext(e)):(n.state=`settled`,this.sendMCPToolApprovalResult(e.tool_call_id,t))}markMCPApprovalStale(e){let t=this.mcpApprovals.get(e);t&&t.state===`pending`&&(t.state=`stale`,t.controller.abort())}mcpApprovalErrorContext(e){return{toolCallId:e.tool_call_id,toolName:e.tool_name,serviceId:e.service_id}}handleMCPConnectionStatus(e){this.options.onMCPConnectionStatus&&this.options.onMCPConnectionStatus(e.mcp_connection_status)}handleAgentToolRequest(e){this.options.onAgentToolRequest&&this.options.onAgentToolRequest(e.agent_tool_request)}handleAgentToolResponse(e){e.agent_tool_response.tool_name===`end_call`&&this.endSessionWithDetails(W).catch(e=>{this.onError(`Failed to end session after agent end_call`,e)}),this.options.onAgentToolResponse?.(e.agent_tool_response)}handleAgentToolResponseFullPayload(e){e.agent_tool_response_full_payload.tool_name===`end_call`&&this.endSessionWithDetails(W).catch(e=>{this.onError(`Failed to end session after agent end_call`,e)}),this.options.onAgentToolResponse?.(e.agent_tool_response_full_payload)}handleConversationMetadata(e){this.options.onConversationMetadata&&this.options.onConversationMetadata(e.conversation_initiation_metadata_event)}handleAsrInitiationMetadata(e){this.options.onAsrInitiationMetadata&&this.options.onAsrInitiationMetadata(e.asr_initiation_metadata_event)}handleAgentChatResponsePart(e){this.options.onAgentChatResponsePart&&this.options.onAgentChatResponsePart(e.text_response_part)}handleAgentReasoningResponsePart(e){this.options.onAgentReasoningResponsePart&&this.options.onAgentReasoningResponsePart(e.reasoning_response_part)}handleRichContent(e){this.options.onRichContent&&this.options.onRichContent(e.rich_content)}handleGuardrailTriggered(e){this.options.onGuardrailTriggered&&this.options.onGuardrailTriggered()}handleAgentTyping(e){this.options.onAgentTyping&&this.options.onAgentTyping(e.agent_typing_event)}handleExternalAgentConnected(e){this.options.onExternalAgentConnected&&this.options.onExternalAgentConnected()}handleExternalAgentDisconnected(e){this.options.onExternalAgentDisconnected&&this.options.onExternalAgentDisconnected()}handleErrorEvent(e){let t=e.error_event,n=t?.error_type,r=t?.message||t?.reason||`Unknown error`;n===`max_duration_exceeded`?this.endSessionWithDetails({reason:`error`,message:r,context:{type:`max_duration_exceeded`}}).catch(e=>{this.onError(`Failed to end session after max_duration_exceeded`,e)}):this.onError(`Server error: ${r}`,{errorType:n,code:t?.code,debugMessage:t?.debug_message,details:t?.details})}onMessage=async e=>{switch(this.options.onIncomingEvent?.(e),e.type){case`interruption`:this.handleInterruption(e);return;case`agent_response`:this.handleAgentResponse(e);return;case`agent_response_correction`:this.handleAgentResponseCorrection(e);return;case`user_transcript`:this.handleUserTranscript(e);return;case`internal_tentative_agent_response`:this.handleTentativeAgentResponse(e);return;case`client_tool_call`:try{await this.handleClientToolCall(e)}catch(t){this.onError(`Unexpected error in client tool call handling: ${t instanceof Error?t.message:String(t)}`,{clientToolName:e.client_tool_call.tool_name,toolCallId:e.client_tool_call.tool_call_id})}return;case`audio`:this.handleAudio(e);return;case`vad_score`:this.handleVadScore(e);return;case`ping`:this.connection.sendMessage({type:`pong`,event_id:e.ping_event.event_id}),this.handlePing(e);return;case`context_usage`:this.handleContextUsage(e);return;case`mcp_tool_call`:try{await this.handleMCPToolCall(e)}catch(t){this.onError(`Unexpected error in MCP tool call handling: ${t instanceof Error?t.message:String(t)}`,{toolCallId:e.mcp_tool_call.tool_call_id,toolName:e.mcp_tool_call.tool_name})}return;case`mcp_connection_status`:this.handleMCPConnectionStatus(e);return;case`agent_tool_request`:this.handleAgentToolRequest(e);return;case`agent_tool_response`:this.handleAgentToolResponse(e);return;case`agent_tool_response_full_payload`:this.handleAgentToolResponseFullPayload(e);return;case`conversation_initiation_metadata`:this.handleConversationMetadata(e);return;case`asr_initiation_metadata`:this.handleAsrInitiationMetadata(e);return;case`agent_chat_response_part`:this.handleAgentChatResponsePart(e);return;case`agent_reasoning_response_part`:this.handleAgentReasoningResponsePart(e);return;case`rich_content`:this.handleRichContent(e);return;case`guardrail_triggered`:this.handleGuardrailTriggered(e);return;case`error`:this.handleErrorEvent(e);return;case`agent_typing`:this.handleAgentTyping(e);return;case`external_agent_connected`:this.handleExternalAgentConnected(e);return;case`external_agent_disconnected`:this.handleExternalAgentDisconnected(e);return;default:this.options.onDebug&&this.options.onDebug(e);return}};onError(e,t){console.error(e,t),this.options.onError&&this.options.onError(e,t)}onOutgoingMessage=e=>{this.options.onOutgoingEvent?.(e)};getId(){return this.connection.conversationId}isOpen(){return this.status===`connected`}sendFeedback(e,t){this.canSendFeedback?this.connection.sendMessage({type:`feedback`,score:e===null?null:e?`like`:`dislike`,event_id:t??this.currentEventId}):console.warn(`Cannot send feedback: the conversation is not connected.`)}sendContextualUpdate(e,t){this.connection.sendMessage({type:`contextual_update`,text:e,...t?.contextId?{context_id:t.contextId}:{}})}sendUserMessage(e,t){this.connection.sendMessage({type:`user_message`,text:e,rich_content_id:t?.richContentId??void 0})}sendUserActivity(){this.connection.sendMessage({type:`user_activity`})}sendMCPToolApprovalResult(e,t){this.connection.sendMessage({type:`mcp_tool_approval_result`,tool_call_id:e,is_approved:t})}sendMultimodalMessage(e){let t=(e.fileIds?.length?e.fileIds:e.fileId?[e.fileId]:[]).map(e=>({type:`file_input`,file_id:e}));this.connection.sendMessage({type:`multimodal_message`,text:e.text?{type:`user_message`,text:e.text}:void 0,file:t[0],files:t.length?t:void 0})}async uploadFile(e){if(this.options.orchestrator)throw Error(`uploadFile is not supported for self-hosted orchestrator sessions.`);return We({conversationId:this.connection.conversationId,origin:this.options.origin,file:e})}};function Ge(){for(let e of[`fetch`,`WebSocket`,`TextEncoder`,`TextDecoder`,`URL`,`btoa`,`atob`])if(globalThis[e]===void 0)throw Error(`${e} is not available in this environment.`)}var q=new Uint8Array,J=class e extends K{type=`text`;setVolume(){throw Error(`setVolume is not supported in text conversations`)}setMicMuted(){throw Error(`setMicMuted is not supported in text conversations`)}getInputByteFrequencyData(){return q}getOutputByteFrequencyData(){return q}getInputVolume(){return 0}getOutputVolume(){return 0}static async startSession(t){let n=K.getFullOptions(t);n.onStatusChange&&n.onStatusChange({status:`connecting`}),n.onCanSendFeedbackChange&&n.onCanSendFeedbackChange({canSendFeedback:!1}),n.onModeChange&&n.onModeChange({mode:`listening`}),n.onCanSendFeedbackChange&&n.onCanSendFeedbackChange({canSendFeedback:!1});let r=null,i=null;try{return await P(N(n.connectionDelay)),r=await M(n),i=new e(n,r),n.onConversationCreated?.(i),i.markConnected(),n.onConnect?.({conversationId:r.conversationId}),i}catch(e){throw i?await i.endSession().catch(()=>{}):(n.onStatusChange?.({status:`disconnected`}),r?.close()),e}}},Y=class e extends K{input;output;playbackEventTarget;cleanUp;type=`voice`;static async startSession(t){let n=K.getFullOptions(t);n.onStatusChange&&n.onStatusChange({status:`connecting`}),n.onCanSendFeedbackChange&&n.onCanSendFeedbackChange({canSendFeedback:!1});let r=null,i=null;try{return i=await le()(n),r=new e(n,i.connection,i.input,i.output,i.playbackEventTarget,i.detach),n.onConversationCreated?.(r),r.markConnected(),n.onConnect?.({conversationId:i.connection.conversationId}),r}catch(e){throw r?await r.endSession().catch(()=>{}):(i&&await i.detach().catch(()=>{}),n.onStatusChange?.({status:`disconnected`})),e}}inputFrequencyData;outputFrequencyData;handlePlaybackEvent=e=>{e.data.type===`process`&&this.updateMode(e.data.finished?`listening`:`speaking`)};constructor(e,t,n,r,i,a){super(e,t),this.input=n,this.output=r,this.playbackEventTarget=i,this.cleanUp=a,i?.addListener(this.handlePlaybackEvent)}async handleEndSession(){this.playbackEventTarget?.removeListener(this.handlePlaybackEvent),this.playbackEventTarget=null,await this.cleanUp(),await super.handleEndSession(),await this.input.close(),await this.output.close()}handleInterruption(e){super.handleInterruption(e),this.updateMode(`listening`),this.output.interrupt()}handleAudio(e){super.handleAudio(e),e.audio_event.alignment&&this.options.onAudioAlignment&&this.options.onAudioAlignment(e.audio_event.alignment),this.lastInterruptTimestamp<=e.audio_event.event_id&&(e.audio_event.audio_base_64&&this.options.onAudio?.(e.audio_event.audio_base_64),this.currentEventId=e.audio_event.event_id,this.updateCanSendFeedback(),this.updateMode(`speaking`))}static FREQUENCY_BIN_COUNT=1024;setMicMuted(e){this.input.setMuted(e).catch(e=>{this.options.onError?.(`Failed to set input muted state`,e)})}getInputByteFrequencyData(){return this.inputFrequencyData??=new Uint8Array(e.FREQUENCY_BIN_COUNT),this.input.getByteFrequencyData(this.inputFrequencyData),this.inputFrequencyData}getOutputByteFrequencyData(){return this.outputFrequencyData??=new Uint8Array(e.FREQUENCY_BIN_COUNT),this.output.getByteFrequencyData(this.outputFrequencyData),this.outputFrequencyData}getInputVolume(){return this.input.getVolume()}getOutputVolume(){return this.output.getVolume()}async changeInputDevice({sampleRate:e,format:t,preferHeadphonesForIosDevices:n,inputDeviceId:r}){try{await this.input.setDevice({inputDeviceId:r,sampleRate:e,format:t,preferHeadphonesForIosDevices:n})}catch(e){throw console.error(`Error changing input device`,e),e}}async changeOutputDevice({sampleRate:e,format:t,outputDeviceId:n}){try{await this.output.setDevice({outputDeviceId:n,sampleRate:e,format:t})}catch(e){throw console.error(`Error changing output device`,e),e}}setVolume=({volume:e})=>{let t=Number.isFinite(e)?Math.min(1,Math.max(0,e)):1;this.volume=t,this.output.setVolume(t)}},Ke=`https://api.elevenlabs.io`;function qe(e,t,n=Ke){let r={};return typeof t==`boolean`?r.feedback=t?`like`:`dislike`:(r.rating=t.rating,r.comment=t.comment),fetch(`${n}/v1/convai/conversations/${e}/feedback`,{method:`POST`,body:JSON.stringify(r),headers:{"Content-Type":`application/json`}})}var Je=class{listeners=new Map;on(e,t){this.listeners.has(e)||this.listeners.set(e,new Set);let n=this.listeners.get(e);n&&n.add(t)}off(e,t){let n=this.listeners.get(e);n&&n.delete(t)}emit(e,...t){let n=this.listeners.get(e);n&&n.forEach(e=>{e(...t)})}};function Ye(e){return typeof e==`object`&&e&&`message_type`in e&&`error`in e&&typeof e.message_type==`string`&&typeof e.error==`string`?e:{message_type:`error`,error:e instanceof Error?e.message:String(e)}}var X;(function(e){e.SESSION_STARTED=`session_started`,e.PARTIAL_TRANSCRIPT=`partial_transcript`,e.FINAL_TRANSCRIPT=`final_transcript`,e.FINAL_TRANSCRIPT_WITH_TIMESTAMPS=`final_transcript_with_timestamps`,e.COMMITTED_TRANSCRIPT=`committed_transcript`,e.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS=`committed_transcript_with_timestamps`,e.COMMITTED_TRANSCRIPT_ENTITIES=`committed_transcript_entities`,e.AUTH_ERROR=`auth_error`,e.ERROR=`error`,e.OPEN=`open`,e.CLOSE=`close`,e.QUOTA_EXCEEDED=`quota_exceeded`,e.COMMIT_THROTTLED=`commit_throttled`,e.TRANSCRIBER_ERROR=`transcriber_error`,e.UNACCEPTED_TERMS=`unaccepted_terms`,e.RATE_LIMITED=`rate_limited`,e.INPUT_ERROR=`input_error`,e.INVALID_REQUEST=`invalid_request`,e.QUEUE_OVERFLOW=`queue_overflow`,e.RESOURCE_EXHAUSTED=`resource_exhausted`,e.SESSION_TIME_LIMIT_EXCEEDED=`session_time_limit_exceeded`,e.CHUNK_SIZE_EXCEEDED=`chunk_size_exceeded`,e.INSUFFICIENT_AUDIO_ACTIVITY=`insufficient_audio_activity`})(X||={});var Z=class{websocket=null;eventEmitter=new Je;currentSampleRate=16e3;_muted=!1;_closed=!1;_audioCleanup;_mediaStreamTrack;constructor(e){this.currentSampleRate=e}get isMuted(){return this._muted}getMediaStreamTrackForMute(e){if(!this._mediaStreamTrack)throw Error(`Cannot ${e} audio without an active microphone MediaStreamTrack. mute() and unmute() are only supported for microphone connections.`);return this._mediaStreamTrack}mute(){let e=this.getMediaStreamTrackForMute(`mute`);this._muted=!0,e.enabled=!1}unmute(){let e=this.getMediaStreamTrackForMute(`unmute`);this._muted=!1,e.enabled=!0}setWebSocket(e){this.websocket=e,this.websocket.readyState===WebSocket.OPEN?this.eventEmitter.emit(X.OPEN):this.websocket.addEventListener(`open`,()=>{this.eventEmitter.emit(X.OPEN)}),this.websocket.addEventListener(`message`,e=>{try{let t=JSON.parse(e.data);switch(t.message_type){case`session_started`:this.eventEmitter.emit(X.SESSION_STARTED,t);break;case`partial_transcript`:this.eventEmitter.emit(X.PARTIAL_TRANSCRIPT,t);break;case`final_transcript`:this.eventEmitter.emit(X.FINAL_TRANSCRIPT,t);break;case`final_transcript_with_timestamps`:this.eventEmitter.emit(X.FINAL_TRANSCRIPT_WITH_TIMESTAMPS,t);break;case`committed_transcript`:this.eventEmitter.emit(X.COMMITTED_TRANSCRIPT,t);break;case`committed_transcript_with_timestamps`:this.eventEmitter.emit(X.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS,t);break;case`committed_transcript_entities`:this.eventEmitter.emit(X.COMMITTED_TRANSCRIPT_ENTITIES,t);break;case`auth_error`:this.eventEmitter.emit(X.AUTH_ERROR,t),this.eventEmitter.emit(X.ERROR,t);break;case`quota_exceeded`:this.eventEmitter.emit(X.QUOTA_EXCEEDED,t),this.eventEmitter.emit(X.ERROR,t);break;case`commit_throttled`:this.eventEmitter.emit(X.COMMIT_THROTTLED,t),this.eventEmitter.emit(X.ERROR,t);break;case`transcriber_error`:this.eventEmitter.emit(X.TRANSCRIBER_ERROR,t),this.eventEmitter.emit(X.ERROR,t);break;case`unaccepted_terms`:this.eventEmitter.emit(X.UNACCEPTED_TERMS,t),this.eventEmitter.emit(X.ERROR,t);break;case`rate_limited`:this.eventEmitter.emit(X.RATE_LIMITED,t),this.eventEmitter.emit(X.ERROR,t);break;case`input_error`:this.eventEmitter.emit(X.INPUT_ERROR,t),this.eventEmitter.emit(X.ERROR,t);break;case`invalid_request`:this.eventEmitter.emit(X.INVALID_REQUEST,t),this.eventEmitter.emit(X.ERROR,t);break;case`queue_overflow`:this.eventEmitter.emit(X.QUEUE_OVERFLOW,t),this.eventEmitter.emit(X.ERROR,t);break;case`resource_exhausted`:this.eventEmitter.emit(X.RESOURCE_EXHAUSTED,t),this.eventEmitter.emit(X.ERROR,t);break;case`session_time_limit_exceeded`:this.eventEmitter.emit(X.SESSION_TIME_LIMIT_EXCEEDED,t),this.eventEmitter.emit(X.ERROR,t);break;case`chunk_size_exceeded`:this.eventEmitter.emit(X.CHUNK_SIZE_EXCEEDED,t),this.eventEmitter.emit(X.ERROR,t);break;case`insufficient_audio_activity`:this.eventEmitter.emit(X.INSUFFICIENT_AUDIO_ACTIVITY,t),this.eventEmitter.emit(X.ERROR,t);break;case`error`:this.eventEmitter.emit(X.ERROR,t);break;default:console.warn(`Unknown message type:`,t)}}catch(t){console.error(`Failed to parse WebSocket message:`,t,e.data),this._emitError(Error(`Failed to parse message: ${t}`))}}),this.websocket.addEventListener(`error`,e=>{this._closed||(console.error(`WebSocket error:`,e),this._emitError(Error(`WebSocket error`)))}),this.websocket.addEventListener(`close`,e=>{let t=this._closed;if(this._closed=!0,!t&&(console.log(`WebSocket closed: code=${e.code}, reason="${e.reason}", wasClean=${e.wasClean}`),!e.wasClean||e.code!==1e3&&e.code!==1005)){let t=`WebSocket closed unexpectedly: ${e.code} - ${e.reason||`No reason provided`}`;console.error(t),this._emitError(Error(t))}this._audioCleanup&&=(this._audioCleanup(),void 0),this.eventEmitter.emit(X.CLOSE,e)})}on(e,t){this.eventEmitter.on(e,t)}off(e,t){this.eventEmitter.off(e,t)}_emitError(e){this.eventEmitter.emit(X.ERROR,Ye(e))}send(e){if(!this.websocket||this.websocket.readyState!==WebSocket.OPEN)throw Error(`WebSocket is not connected`);let t={message_type:`input_audio_chunk`,audio_base_64:e.audioBase64,commit:e.commit??!1,sample_rate:e.sampleRate??this.currentSampleRate,previous_text:e.previousText};this.websocket.send(JSON.stringify(t))}commit(){if(!this.websocket||this.websocket.readyState!==WebSocket.OPEN)throw Error(`WebSocket is not connected`);let e={message_type:`input_audio_chunk`,audio_base_64:``,commit:!0,sample_rate:this.currentSampleRate};this.websocket.send(JSON.stringify(e))}close(){this._closed=!0,this._audioCleanup&&=(this._audioCleanup(),void 0),this.websocket&&this.websocket.close(1e3,`User ended session`)}},Q;(function(e){e.PCM_8000=`pcm_8000`,e.PCM_16000=`pcm_16000`,e.PCM_22050=`pcm_22050`,e.PCM_24000=`pcm_24000`,e.PCM_44100=`pcm_44100`,e.PCM_48000=`pcm_48000`,e.ULAW_8000=`ulaw_8000`})(Q||={});var $;(function(e){e.MANUAL=`manual`,e.VAD=`vad`})($||={});var Xe=class e{static DEFAULT_BASE_URI=`wss://api.elevenlabs.io`;static getWebSocketUri(t=e.DEFAULT_BASE_URI){return`${t}/v1/speech-to-text/realtime`}static buildWebSocketUri(t){let n=e.getWebSocketUri(t.baseUri),r=new URLSearchParams;if(r.append(`model_id`,t.modelId),r.append(`token`,t.token),t.commitStrategy!==void 0&&r.append(`commit_strategy`,t.commitStrategy),t.audioFormat!==void 0&&r.append(`audio_format`,t.audioFormat),t.vadSilenceThresholdSecs!==void 0){if(t.vadSilenceThresholdSecs<.3||t.vadSilenceThresholdSecs>3)throw Error(`vadSilenceThresholdSecs must be between 0.3 and 3.0`);r.append(`vad_silence_threshold_secs`,t.vadSilenceThresholdSecs.toString())}if(t.vadThreshold!==void 0){if(t.vadThreshold<.1||t.vadThreshold>.9)throw Error(`vadThreshold must be between 0.1 and 0.9`);r.append(`vad_threshold`,t.vadThreshold.toString())}if(t.minSpeechDurationMs!==void 0){if(t.minSpeechDurationMs<50||t.minSpeechDurationMs>2e3)throw Error(`minSpeechDurationMs must be between 50 and 2000`);r.append(`min_speech_duration_ms`,t.minSpeechDurationMs.toString())}if(t.minSilenceDurationMs!==void 0){if(t.minSilenceDurationMs<50||t.minSilenceDurationMs>2e3)throw Error(`minSilenceDurationMs must be between 50 and 2000`);r.append(`min_silence_duration_ms`,t.minSilenceDurationMs.toString())}if(t.languageCode!==void 0&&r.append(`language_code`,t.languageCode),t.secondaryLanguages!==void 0)for(let e of t.secondaryLanguages)r.append(`secondary_languages`,e);if(t.includeTimestamps!==void 0&&r.append(`include_timestamps`,t.includeTimestamps?`true`:`false`),t.includeLanguageDetection!==void 0&&r.append(`include_language_detection`,t.includeLanguageDetection?`true`:`false`),t.keyterms!==void 0)for(let e of t.keyterms)r.append(`keyterms`,e);if(t.noVerbatim!==void 0&&r.append(`no_verbatim`,t.noVerbatim?`true`:`false`),t.entityDetection!==void 0){let e=Array.isArray(t.entityDetection)?t.entityDetection:[t.entityDetection];for(let t of e)r.append(`entity_detection`,t)}t.filterBackgroundAudio!==void 0&&r.append(`filter_background_audio`,t.filterBackgroundAudio?`true`:`false`),t.enableLogging!==void 0&&r.append(`enable_logging`,t.enableLogging?`true`:`false`);let i=r.toString();return i?`${n}?${i}`:n}static connect(t){if(!t.modelId)throw Error(`modelId is required`);let n=new Z(`microphone`in t&&t.microphone?16e3:t.sampleRate),r=e.buildWebSocketUri(t),i=new WebSocket(r);return`microphone`in t&&t.microphone&&i.addEventListener(`open`,()=>{e.streamFromMicrophone(t,n)}),n.setWebSocket(i),n}static async streamFromMicrophone(e,t){try{let n=await Be()(e.microphone??{},e=>{t._closed||t.send({audioBase64:e})});t._mediaStreamTrack=n.mediaStreamTrack,t._audioCleanup=n.cleanup,t._closed&&(n.cleanup(),t._audioCleanup=void 0)}catch(e){console.error(`Failed to start microphone streaming:`,e),t._emitError(e),t.close()}}},Ze={async startSession(e){return Ge(),G(e)?J.startSession(e):Y.startSession(e)}};Pe(),te(()=>new Re),ze(He);export{Q as AudioFormat,$ as CommitStrategy,Ze as Conversation,ve as DEFAULT_INPUT_CHUNK_DURATION_MS,Z as RealtimeConnection,X as RealtimeEvents,Xe as Scribe,u as SessionConnectionError,J as TextConversation,Y as VoiceConversation,b as WebRTCConnection,j as WebSocketConnection,M as createConnection,qe as postOverallFeedback};