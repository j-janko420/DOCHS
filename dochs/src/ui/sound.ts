// Door-open sound, synthesised with Web Audio (no audio files): latch click,
// a short hinge creak and the air of the leaf swinging. Muted when the user
// turns sound off (remembered in this browser).

const KEY = 'dorsch.sound';

export function soundOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setSound(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage blocked: session only */ }
}

export function doorOpenSound() {
  if (!soundOn()) return;
  const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  let ctx: AudioContext;
  try { ctx = new AC(); } catch { return; }
  const t = ctx.currentTime + 0.01;
  const master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);
  const noise = (dur: number) => {
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = b;
    return s;
  };
  // latch: two quick metallic ticks
  for (const [at, f] of [[0, 3200], [0.045, 2400]] as const) {
    const n = noise(0.05), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
    g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(0.9, t + at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.045);
    n.connect(bp).connect(g).connect(master);
    n.start(t + at); n.stop(t + at + 0.06);
  }
  // hinge creak: a gliding sawtooth chopped by a stick-slip tremolo
  const osc = ctx.createOscillator(), trem = ctx.createOscillator(), tg = ctx.createGain(), cg = ctx.createGain(), bp = ctx.createBiquadFilter();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(190, t + 0.08); osc.frequency.linearRampToValueAtTime(120, t + 0.42); osc.frequency.linearRampToValueAtTime(150, t + 0.62);
  trem.type = 'square'; trem.frequency.setValueAtTime(34, t + 0.08); trem.frequency.linearRampToValueAtTime(22, t + 0.62);
  tg.gain.value = 0.5;
  bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 4;
  cg.gain.setValueAtTime(0.0001, t + 0.08); cg.gain.exponentialRampToValueAtTime(0.16, t + 0.16); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.66);
  trem.connect(tg).connect(cg.gain);
  osc.connect(bp).connect(cg).connect(master);
  osc.start(t + 0.08); trem.start(t + 0.08); osc.stop(t + 0.7); trem.stop(t + 0.7);
  // swing: soft filtered air
  const air = noise(0.7), lp = ctx.createBiquadFilter(), ag = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t + 0.1); lp.frequency.linearRampToValueAtTime(1400, t + 0.45); lp.frequency.linearRampToValueAtTime(400, t + 0.8);
  ag.gain.setValueAtTime(0.0001, t + 0.1); ag.gain.exponentialRampToValueAtTime(0.18, t + 0.4); ag.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
  air.connect(lp).connect(ag).connect(master);
  air.start(t + 0.1); air.stop(t + 0.9);
  setTimeout(() => { void ctx.close().catch(() => undefined); }, 1200);
}
