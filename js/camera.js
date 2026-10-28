// Kamerazugriff und Verfolgung des erkannten Dokuments über mehrere Bilder hinweg.

import { lerpQuad, maxCornerShift } from './geometry.js';

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
  }

  get ready() {
    return !!this.stream && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }
  get width() { return this.video.videoWidth; }
  get height() { return this.video.videoHeight; }

  async start() {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('Kamera nicht verfügbar');
      err.name = 'InsecureContext';
      throw err;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** Aktuelles Kamerabild in voller Auflösung als Canvas. */
  grab() {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    canvas.getContext('2d').drawImage(this.video, 0, 0);
    return canvas;
  }
}

/**
 * Glättet das erkannte Viereck über die Zeit und meldet, wie lange es schon ruhig liegt.
 * Nach einer Aufnahme wird erst wieder ausgelöst, wenn das Blatt verschwunden ist
 * oder deutlich bewegt wurde – so entsteht dieselbe Seite nicht doppelt.
 */
export class QuadTracker {
  constructor(holdMs = 1000) {
    this.holdMs = holdMs;
    this.quad = null;
    this.misses = 0;
    this.stableSince = 0;
    this.lastSeen = 0;
    this.captured = null;
  }

  update(q, now, diag) {
    if (q) {
      const shift = this.quad ? maxCornerShift(this.quad, q) : Infinity;
      if (shift < diag * 0.08) {
        this.quad = lerpQuad(this.quad, q, 0.45);
        if (shift > diag * 0.015) this.stableSince = now;
      } else {
        this.quad = q;
        this.stableSince = now;
      }
      this.misses = 0;
      this.lastSeen = now;
      if (this.captured && maxCornerShift(this.captured, this.quad) > diag * 0.12) this.captured = null;
    } else if (++this.misses > 3) {
      this.quad = null;
    }
    if (this.captured && now - this.lastSeen > 700) this.captured = null;
  }

  /** 0 … 1: wie weit die Wartezeit bis zur automatischen Aufnahme abgelaufen ist. */
  progress(now) {
    if (!this.quad || this.captured) return 0;
    return Math.min(1, (now - this.stableSince) / this.holdMs);
  }

  markCaptured() {
    this.captured = this.quad;
  }

  reset() {
    this.quad = null;
    this.misses = 0;
    this.captured = null;
  }
}
