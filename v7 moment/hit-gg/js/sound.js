/* ============================================================
   SOUND SYSTEM v4 — richer, casino-grade WebAudio synths.
   Everything runs through a compressed master bus for punch and
   consistent loudness. Zero assets required, but any entry in
   SOUND_FILES with a URL plays the real file instead.

   RECOMMENDED REAL ASSETS (drop into /audio and fill URLs below):
   Kenney's "Casino Audio" pack (kenney.nl/assets/casino-audio,
   CC0 — free for commercial use) covers cards, chips and dice:
     card:  audio/card-place-1.ogg      (or card-slide-1.ogg)
     bet:   audio/chips-stack-2.ogg
     snap:  audio/dice-throw-1.ogg
   For wins/losses, license short stingers from a library such as
   Pixabay SFX, ZapSplat, or Soundly, e.g.:
     win:     audio/win-stinger.mp3    (bright 0.8s casino chime)
     bigwin:  audio/bigwin-fanfare.mp3 (2s slot jackpot fanfare)
     cashout: audio/cashout-coins.mp3  (register + coin shower)
     lose:    audio/lose-soft.mp3      (short muted descend)
   Keep files < 100KB, mono, 44.1kHz — they're preloaded on first play.

   // TODO: Backend/asset pipeline — persist a per-account master
   // volume, and serve the audio manifest with cache-busting hashes.
   ============================================================ */

const SOUND_PREF_KEY = 'hitgg_sound_v1';
let soundEnabled = localStorage.getItem(SOUND_PREF_KEY) !== 'off';
let audioCtx = null;
let sfxBus = null; // compressor -> master gain -> destination

/* Put real file URLs here to override the synth per-sound. */
const SOUND_FILES = {
  click:   null,
  bet:     null,   // chip clack
  win:     null,
  bigwin:  null,
  lose:    null,
  gem:     null,
  bomb:    null,
  card:    null,   // card slide/flip
  ball:    null,   // plinko peg tick
  land:    null,   // ball lands / marker settles
  snap:    null,   // dice snap / whip
  levelup: null,
  cashout: null,
  tick:    null,
};
const soundBuffers = {};

function ensureAudioCtx(){
  if(!audioCtx){
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return null;
    audioCtx = new Ctx();
  }
  if(audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/* Master bus: gentle compression glues the layers together and
   lets simultaneous hits (snap + land + win) stay clean. */
function bus(){
  const ctx = ensureAudioCtx();
  if(!ctx) return null;
  if(!sfxBus){
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.14;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    comp.connect(master).connect(ctx.destination);
    sfxBus = comp;
  }
  return sfxBus;
}

function toggleSound(){
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_PREF_KEY, soundEnabled ? 'on' : 'off');
  renderSoundToggle();
  if(soundEnabled) playSound('click');
}
function renderSoundToggle(){
  const btn = document.getElementById('sound-toggle');
  if(!btn) return;
  btn.innerHTML = soundEnabled ? '&#128266;' : '&#128263;';
  btn.classList.toggle('muted', !soundEnabled);
  btn.title = soundEnabled ? 'Sound on' : 'Sound off';
}

/* ---------- Synth primitives ---------- */
function tone({freq=440, dur=0.12, type='sine', vol=0.25, slideTo=null, delay=0, attack=0.008}){
  const ctx = ensureAudioCtx();
  const out = bus();
  if(!ctx || !out) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if(slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noiseBurst({dur=0.25, vol=0.3, delay=0, filter='lowpass', freq=1200, freqTo=null, q=0.8}){
  const ctx = ensureAudioCtx();
  const out = bus();
  if(!ctx || !out) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for(let i=0;i<len;i++) data[i] = (Math.random()*2-1) * (1 - i/len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = filter;
  filt.Q.value = q;
  filt.frequency.setValueAtTime(freq, t0);
  if(freqTo) filt.frequency.exponentialRampToValueAtTime(Math.max(60, freqTo), t0 + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt).connect(gain).connect(out);
  src.start(t0);
}

/* Metallic coin ping — two inharmonic partials, fast decay.
   Layer a few for a proper coin-shower "cha-ching". */
function coin(freq=1976, {vol=0.16, dur=0.22, delay=0} = {}){
  tone({freq, dur, type:'sine', vol, delay, attack:0.002});
  tone({freq:freq*2.51, dur:dur*0.7, type:'sine', vol:vol*0.5, delay, attack:0.002});
  tone({freq:freq*4.13, dur:dur*0.4, type:'sine', vol:vol*0.22, delay, attack:0.002});
}

/* Ceramic chip clack — bandpass crack + low knock. */
function chipClack({vol=1, delay=0} = {}){
  noiseBurst({dur:0.045, vol:0.30*vol, delay, filter:'bandpass', freq:2100, q:1.4});
  tone({freq:210, dur:0.06, type:'triangle', vol:0.20*vol, delay, attack:0.002});
}

/* ---------- The SFX bank ---------- */
const SYNTHS = {
  click:  () => { tone({freq:1700, dur:0.035, type:'sine', vol:0.09, attack:0.002}); noiseBurst({dur:0.02, vol:0.05, filter:'highpass', freq:4000}); },
  tick:   () => tone({freq:2300, dur:0.02, type:'sine', vol:0.045, attack:0.001}),

  // Chips hitting the felt — double clack sells the stack
  bet:    () => { chipClack(); chipClack({vol:0.6, delay:0.05}); },

  // Card slide: filtered noise swish sweeping upward
  card:   () => noiseBurst({dur:0.09, vol:0.14, filter:'bandpass', freq:900, freqTo:3400, q:0.9}),

  gem:    () => { coin(1568, {vol:0.14}); coin(2093, {vol:0.12, delay:0.06}); },

  ball:   () => tone({freq:650 + Math.random()*550, dur:0.032, type:'triangle', vol:0.07, attack:0.002}),

  // Solid thock when something lands
  land:   () => {
    tone({freq:190, dur:0.13, type:'sine', vol:0.34, slideTo:85, attack:0.003});
    noiseBurst({dur:0.05, vol:0.14, filter:'lowpass', freq:1100});
  },

  // Dice snap — a whip crack: bright noise + fast pitch drop
  snap:   () => {
    noiseBurst({dur:0.05, vol:0.26, filter:'highpass', freq:2400});
    tone({freq:950, dur:0.08, type:'triangle', vol:0.22, slideTo:180, attack:0.002});
  },

  // Win: bright major arpeggio with a sparkle tail
  win:    () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f,i) => {
      tone({freq:f, dur:0.18, type:'triangle', vol:0.20, delay:i*0.07});
      tone({freq:f*2, dur:0.14, type:'sine', vol:0.06, delay:i*0.07 + 0.02});
    });
    noiseBurst({dur:0.4, vol:0.05, delay:0.16, filter:'highpass', freq:6000});
  },

  // Cashout: register cha-ching + coin shower
  cashout:() => {
    tone({freq:160, dur:0.09, type:'triangle', vol:0.22, attack:0.002}); // register thump
    coin(1976, {vol:0.17, delay:0.03});
    coin(2637, {vol:0.15, delay:0.10});
    coin(3136, {vol:0.13, delay:0.17});
    noiseBurst({dur:0.35, vol:0.05, delay:0.08, filter:'highpass', freq:5500});
  },

  // Big win: sub thump, rising gliss, stacked chord, shimmer
  bigwin: () => {
    tone({freq:62, dur:0.5, type:'sine', vol:0.4, attack:0.004});                       // sub hit
    tone({freq:220, dur:0.35, type:'triangle', vol:0.16, slideTo:880, attack:0.01});    // riser
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f,i) => {
      tone({freq:f, dur:0.30, type:'triangle', vol:0.20, delay:0.18 + i*0.06});
    });
    [1046.5, 1318.5, 1568, 2093].forEach((f,i) => {
      tone({freq:f, dur:0.26, type:'sine', vol:0.10, delay:0.55 + i*0.06});
    });
    noiseBurst({dur:1.0, vol:0.06, delay:0.2, filter:'highpass', freq:6000});
    coin(2093, {vol:0.10, delay:0.65});
    coin(2637, {vol:0.10, delay:0.78});
  },

  // Lose: soft two-note descend — present, not punishing
  lose:   () => {
    tone({freq:392, dur:0.16, type:'sine', vol:0.13});
    tone({freq:311, dur:0.28, type:'sine', vol:0.11, delay:0.12, slideTo:262});
  },

  // Bomb: sub drop + muffled blast + debris crackle
  bomb:   () => {
    tone({freq:130, dur:0.45, type:'sawtooth', vol:0.22, slideTo:35, attack:0.003});
    noiseBurst({dur:0.5, vol:0.42, filter:'lowpass', freq:600, freqTo:120});
    noiseBurst({dur:0.25, vol:0.12, delay:0.10, filter:'bandpass', freq:1800, q:0.7});
  },

  levelup:() => {
    [392, 523.25, 659.25, 783.99].forEach((f,i) => tone({freq:f, dur:0.16, type:'triangle', vol:0.18, delay:i*0.07}));
    [783.99, 987.77, 1174.7].forEach(f => tone({freq:f, dur:0.42, type:'sine', vol:0.10, delay:0.32}));
    noiseBurst({dur:0.4, vol:0.04, delay:0.3, filter:'highpass', freq:6500});
  },
};

async function playSound(name){
  if(!soundEnabled) return;
  try {
    const url = SOUND_FILES[name];
    if(url){
      const ctx = ensureAudioCtx();
      const out = bus();
      if(!ctx || !out) return;
      if(!soundBuffers[name]){
        const res = await fetch(url);
        soundBuffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
      }
      const src = ctx.createBufferSource();
      src.buffer = soundBuffers[name];
      src.connect(out);
      src.start();
      return;
    }
    SYNTHS[name]?.();
  } catch(e){ /* audio blocked or unavailable — stay silent */ }
}

/* Browsers require a user gesture before audio — unlock on first interaction */
['pointerdown','keydown'].forEach(ev =>
  document.addEventListener(ev, () => ensureAudioCtx(), { once:true, passive:true })
);
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderSoundToggle);
else renderSoundToggle();
