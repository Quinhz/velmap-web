import { S, SOUNDS_STORAGE_KEY } from './state';
import { saveUIState } from './uiState';

export function loadSoundsEnabled() {
    try {
        const raw = localStorage.getItem(SOUNDS_STORAGE_KEY);
        if (raw === null) return true;
        return raw !== 'false';
    } catch (_) {
        return true;
    }
}

export function getCozyAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!S.cozyAudioCtx) S.cozyAudioCtx = new Ctx();
    if (S.cozyAudioCtx.state === 'suspended') {
        S.cozyAudioCtx.resume().catch(() => {});
    }
    return S.cozyAudioCtx;
}

export function playCozyTone(ctx, startOffset, freqStart, freqEnd, duration, peakGain, wave = 'sine') {
    const now = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = wave;
    osc.frequency.setValueAtTime(freqStart, now);
    if (freqEnd && freqEnd !== freqStart) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + duration);
    }

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
}

export function playCozySound(kind) {
    if (!S.soundsEnabled) return;
    try {
        const ctx = getCozyAudioContext();
        if (!ctx) return;
        if (kind === 'check') {
            playCozyTone(ctx, 0, 523.25, 587.33, 0.07, 0.045, 'sine');
            playCozyTone(ctx, 0.042, 659.25, 659.25, 0.12, 0.042, 'triangle');
        } else if (kind === 'uncheck') {
            playCozyTone(ctx, 0, 523.25, 392.0, 0.08, 0.032, 'sine');
        } else if (kind === 'allTasksDone') {
            playCozyTone(ctx, 0, 523.25, 523.25, 0.14, 0.045, 'sine');
            playCozyTone(ctx, 0.065, 659.25, 659.25, 0.16, 0.045, 'sine');
            playCozyTone(ctx, 0.13, 783.99, 783.99, 0.18, 0.048, 'sine');
            playCozyTone(ctx, 0.195, 987.77, 1046.5, 0.34, 0.052, 'triangle');
        } else if (kind === 'boardDrop') {
            playCozyTone(ctx, 0, 293.66, 440.0, 0.12, 0.055, 'sine');
            playCozyTone(ctx, 0.045, 587.33, 659.25, 0.18, 0.038, 'triangle');
        } else if (kind === 'tabDrop') {
            playCozyTone(ctx, 0, 392.0, 523.25, 0.11, 0.05, 'sine');
            playCozyTone(ctx, 0.05, 659.25, 783.99, 0.16, 0.038, 'sine');
        } else if (kind === 'unsorted') {
            playCozyTone(ctx, 0, 349.23, 440.0, 0.1, 0.045, 'sine');
            playCozyTone(ctx, 0.04, 523.25, 523.25, 0.13, 0.034, 'triangle');
        } else if (kind === 'trash') {
            playCozyTone(ctx, 0, 220.0, 125.0, 0.13, 0.045, 'sine');
        } else if (kind === 'restore' || kind === 'pop') {
            playCozyTone(ctx, 0, 392.0, 587.33, 0.12, 0.042, 'sine');
        } else if (kind === 'toggleOn') {
            playCozyTone(ctx, 0, 440.0, 587.33, 0.1, 0.045, 'sine');
            playCozyTone(ctx, 0.055, 659.25, 783.99, 0.16, 0.04, 'triangle');
        }
    } catch (_) {}
}

export function syncSoundsUI() {
    const toggle = document.getElementById('settings-sounds-toggle') as HTMLInputElement | null;
    if (toggle) toggle.checked = !!S.soundsEnabled;
}

export function setSoundsEnabled(enabled) {
    S.soundsEnabled = !!enabled;
    try {
        localStorage.setItem(SOUNDS_STORAGE_KEY, S.soundsEnabled ? 'true' : 'false');
    } catch (_) {}
    saveUIState();
    syncSoundsUI();
    if (S.soundsEnabled) playCozySound('toggleOn');
}
