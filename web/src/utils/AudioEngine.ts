export class AudioEngine {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  public latestData: Float32Array = new Float32Array(1024);
  
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  async startCapture(): Promise<MediaStream> {
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    } as any);

    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.stop();
      throw new Error("No audio track found in display media. Did you check 'Share Audio'?");
    }

    // Initialize recorder on the audio track
    const audioStream = new MediaStream([audioTracks[0]]);
    this.recorder = new MediaRecorder(audioStream);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();

    return this.stream;
  }

  async getCapturedBlob(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
          resolve(new Blob(this.chunks, { type: 'audio/webm' }));
          return;
      }
      this.recorder.onstop = () => {
          resolve(new Blob(this.chunks, { type: 'audio/webm' }));
      };
      this.recorder.stop();
    });
  }

  async setupAnalysis(stream: MediaStream) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 44100
    });
    
    // Explicitly resume in case it's suspended (browser policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    
    this.source = this.audioContext.createMediaStreamSource(stream);
    
    // We use a simple script processor or analyzer for visualization
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    this.source.connect(analyser);

    const tick = () => {
      if (!this.audioContext) return;
      analyser.getFloatTimeDomainData(this.latestData as any);
      requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.audioContext?.close();
    this.stream = null;
    this.audioContext = null;
  }

  /**
   * Simple Peak Normalization
   */
  normalize(buffer: Float32Array): Float32Array {
    let max = 0;
    for (let i = 0; i < buffer.length; i++) {
      const abs = Math.abs(buffer[i]);
      if (abs > max) max = abs;
    }
    
    if (max === 0) return buffer;
    
    const scale = 0.89 / max; // Target -1.0 dBFS approx
    const output = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
        output[i] = buffer[i] * scale;
    }
    return output;
  }
}

export const audioEngine = new AudioEngine();
