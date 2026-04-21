import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

/**
 * Handles in-browser transcoding of captured audio to Opus (.ogg)
 * optimized for Android system assignment.
 */
class Transcoder {
  private ffmpeg: FFmpeg | null = null;
  private loaded = false;

  async load() {
    if (this.loaded) return;
    
    this.ffmpeg = new FFmpeg();
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    
    await this.ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    
    this.loaded = true;
    console.log("Transcoder: FFmpeg Loaded");
  }

  async toOpus(inputBlob: Blob): Promise<Uint8Array> {
    if (!this.ffmpeg || !this.loaded) await this.load();
    const ffmpeg = this.ffmpeg!;

    const inputName = 'input.webm';
    const outputName = 'output.ogg';

    await ffmpeg.writeFile(inputName, await fetchFile(inputBlob));

    // Transcode to OGG Opus at 128kbps (high quality for system sounds)
    // -vn: no video, -acodec libopus: use opus, -b:a 128k: bitrate
    await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'libopus', '-b:a', '128k', outputName]);

    const data = await ffmpeg.readFile(outputName);
    
    // Cleanup
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    return data as Uint8Array;
  }
}

export const transcoder = new Transcoder();
