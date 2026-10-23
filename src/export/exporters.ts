import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Project } from '../model/types';
import { drawScene } from '../render/draw';

export interface ExportRange {
  from: number;
  to: number;
  /** Output pixels per stage unit. */
  scale: number;
  effects: boolean;
  step?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export class ExportCancelled extends Error {
  constructor() { super('Export cancelled'); }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function frameList(r: ExportRange): number[] {
  const out: number[] = [];
  const step = Math.max(1, Math.round(r.step ?? 1));
  for (let f = r.from; f <= r.to; f += step) out.push(f);
  return out;
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return { c, ctx };
}

function renderInto(ctx: CanvasRenderingContext2D, project: Project, frame: number, sx: number, sy: number, effects: boolean) {
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, project.width, project.height);
  ctx.clip();
  drawScene(ctx, project, frame, { effects });
  ctx.restore();
}

export async function exportGif(project: Project, r: ExportRange & { loop: boolean }): Promise<Uint8Array> {
  const w = Math.max(1, Math.round(project.width * r.scale));
  const h = Math.max(1, Math.round(project.height * r.scale));
  const { ctx } = makeCanvas(w, h);
  const frames = frameList(r);
  const gif = GIFEncoder();
  const delay = Math.round((1000 / project.fps) * (r.step ?? 1));
  for (let i = 0; i < frames.length; i++) {
    if (r.signal?.aborted) throw new ExportCancelled();
    renderInto(ctx, project, frames[i], w / project.width, h / project.height, r.effects);
    const { data } = ctx.getImageData(0, 0, w, h);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, w, h, { palette, delay, repeat: r.loop ? 0 : -1 });
    r.onProgress?.(i + 1, frames.length);
    await tick();
  }
  gif.finish();
  return gif.bytes();
}

export interface VideoResult { data: Uint8Array; ext: 'mp4' | 'webm'; mime: string; note?: string }

const AVC_CODECS = ['avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42e01f', 'avc1.42001f'];

export async function exportVideo(project: Project, r: ExportRange & { bitrate: number }): Promise<VideoResult> {
  // H.264 needs even dimensions.
  const w = Math.max(2, Math.round((project.width * r.scale) / 2) * 2);
  const h = Math.max(2, Math.round((project.height * r.scale) / 2) * 2);
  if (typeof VideoEncoder !== 'undefined') {
    for (const codec of AVC_CODECS) {
      const config: VideoEncoderConfig = { codec, width: w, height: h, bitrate: r.bitrate, framerate: project.fps };
      try {
        const sup = await VideoEncoder.isConfigSupported(config);
        if (sup.supported) return await encodeWebCodecs(project, r, config, w, h);
      } catch { /* try the next profile */ }
    }
  }
  return encodeMediaRecorder(project, r, w, h);
}

async function encodeWebCodecs(project: Project, r: ExportRange, config: VideoEncoderConfig, w: number, h: number): Promise<VideoResult> {
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h, frameRate: project.fps }, fastStart: 'in-memory' });
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  encoder.configure(config);
  const { c, ctx } = makeCanvas(w, h);
  const frames = frameList(r);
  const dur = 1e6 / project.fps;
  for (let i = 0; i < frames.length; i++) {
    if (r.signal?.aborted) { encoder.close(); throw new ExportCancelled(); }
    if (failure) throw failure;
    renderInto(ctx, project, frames[i], w / project.width, h / project.height, r.effects);
    const vf = new VideoFrame(c, { timestamp: Math.round(i * dur), duration: Math.round(dur) });
    encoder.encode(vf, { keyFrame: i % (project.fps * 2) === 0 });
    vf.close();
    // Don't let the encoder queue grow without bound.
    while (encoder.encodeQueueSize > 8) await new Promise((res) => setTimeout(res, 2));
    r.onProgress?.(i + 1, frames.length);
    await tick();
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  muxer.finalize();
  return { data: new Uint8Array(muxer.target.buffer), ext: 'mp4', mime: 'video/mp4' };
}

/** Real-time fallback for engines without WebCodecs. */
async function encodeMediaRecorder(project: Project, r: ExportRange, w: number, h: number): Promise<VideoResult> {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot encode video (no WebCodecs or MediaRecorder).');
  const candidates = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('No supported video format for MediaRecorder.');
  const { c, ctx } = makeCanvas(w, h);
  const stream = c.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
  rec.start();
  const frames = frameList(r);
  const interval = 1000 / project.fps;
  const t0 = performance.now();
  for (let i = 0; i < frames.length; i++) {
    if (r.signal?.aborted) { rec.stop(); throw new ExportCancelled(); }
    renderInto(ctx, project, frames[i], w / project.width, h / project.height, r.effects);
    track.requestFrame();
    r.onProgress?.(i + 1, frames.length);
    const wait = t0 + (i + 1) * interval - performance.now();
    await new Promise((res) => setTimeout(res, Math.max(0, wait)));
  }
  rec.stop();
  await stopped;
  const blob = new Blob(chunks, { type: mime });
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  return {
    data: new Uint8Array(await blob.arrayBuffer()), ext, mime: mime.split(';')[0],
    note: ext === 'webm' ? 'This engine cannot write MP4, so the video was saved as WebM.' : undefined,
  };
}

export interface SpriteSheet { png: Uint8Array; json: string; width: number; height: number; count: number }

export async function exportSpriteSheet(project: Project, r: ExportRange & { columns: number; padding: number }): Promise<SpriteSheet> {
  const fw = Math.max(1, Math.round(project.width * r.scale));
  const fh = Math.max(1, Math.round(project.height * r.scale));
  const frames = frameList(r);
  const cols = Math.max(1, Math.min(r.columns, frames.length));
  const rows = Math.ceil(frames.length / cols);
  const pad = Math.max(0, r.padding);
  const W = cols * fw + (cols + 1) * pad, H = rows * fh + (rows + 1) * pad;
  if (W > 16384 || H > 16384) throw new Error(`Sprite sheet would be ${W}×${H}px; reduce scale, range or step.`);
  const { c, ctx } = makeCanvas(W, H);
  const meta: Record<string, unknown> = {};
  for (let i = 0; i < frames.length; i++) {
    if (r.signal?.aborted) throw new ExportCancelled();
    const x = pad + (i % cols) * (fw + pad), y = pad + Math.floor(i / cols) * (fh + pad);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, x, y);
    ctx.scale(fw / project.width, fh / project.height);
    ctx.beginPath();
    ctx.rect(0, 0, project.width, project.height);
    ctx.clip();
    drawScene(ctx, project, frames[i], { effects: r.effects });
    ctx.restore();
    meta[`frame_${String(frames[i]).padStart(4, '0')}`] = {
      frame: { x, y, w: fw, h: fh }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: fw, h: fh }, sourceSize: { w: fw, h: fh },
      duration: Math.round((1000 / project.fps) * (r.step ?? 1)),
    };
    r.onProgress?.(i + 1, frames.length);
    await tick();
  }
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  const json = JSON.stringify({
    frames: meta,
    meta: { app: 'Rowdy Sticks', version: '1', image: '', format: 'RGBA8888', size: { w: W, h: H }, scale: '1', fps: project.fps / (r.step ?? 1) },
  }, null, 2);
  return { png: new Uint8Array(await blob.arrayBuffer()), json, width: W, height: H, count: frames.length };
}
