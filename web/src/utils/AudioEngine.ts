export class AudioEngine {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  public latestData: Float32Array = new Float32Array(1024);
  
  // 10s circular buffer @ 44.1kHz
  private readonly bufferSize = 44100 * 10;
  private circularBuffer = new Float32Array(this.bufferSize);
  private writeIdx = 0;
  private activeSamples = 0;
  private gainNode: GainNode | null = null;
  public isRecording = false;
  private activeSource: AudioBufferSourceNode | null = null;

  isReady(): boolean {
    return this.audioContext !== null && this.audioContext.state === 'running';
  }

  async initialize() {
    const stream = await this.startCapture();
    await this.setupAnalysis(stream);
  }

  async startCapture(): Promise<MediaStream> {
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    } as any);

    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.terminate();
      throw new Error("No audio track found in display media. Did you check 'Share Audio'?");
    }

    return this.stream;
  }

  startRecording() {
    this.isRecording = true;
  }

  pauseRecording() {
    this.isRecording = false;
  }

  resetBuffer() {
    this.circularBuffer.fill(0);
    this.writeIdx = 0;
    this.activeSamples = 0;
  }

  setGain(value: number) {
    if (this.gainNode) {
        this.gainNode.gain.setTargetAtTime(value, 0, 0.05);
    }
  }

  getBufferData() {
    const totalActive = Math.min(this.activeSamples, this.bufferSize);
    const output = new Float32Array(totalActive);
    
    if (this.activeSamples <= this.bufferSize) {
      // Linear copy if we haven't wrapped yet
      output.set(this.circularBuffer.subarray(0, totalActive));
    } else {
      // Re-order if we have wrapped
      for (let i = 0; i < this.bufferSize; i++) {
          output[i] = this.circularBuffer[(this.writeIdx + i) % this.bufferSize];
      }
    }
    return output;
  }

  async getTrimmedBlob(startPct: number, endPct: number): Promise<Blob> {
    const activeData = this.getBufferData();
    const activeLen = activeData.length;
    
    const startIdx = Math.floor(startPct * activeLen);
    const endIdx = Math.floor(endPct * activeLen);
    const length = endIdx - startIdx;
    
    if (length <= 0) throw new Error("Invalid selection range");

    const trimmed = activeData.slice(startIdx, endIdx);
    
    // Convert to mono WAV for Android
    return this.encodeWav(trimmed);
  }

  private encodeWav(samples: Float32Array): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, 44100, true);
    view.setUint32(28, 44100 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
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
    this.gainNode = this.audioContext.createGain();
    
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    
    this.source.connect(this.gainNode);
    this.gainNode.connect(analyser);

    const scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
    scriptProcessor.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        const inputData = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < inputData.length; i++) {
            this.circularBuffer[this.writeIdx] = inputData[i];
            this.writeIdx = (this.writeIdx + 1) % this.bufferSize;
            this.activeSamples++;
        }
    };
    
    this.source.connect(scriptProcessor);
    scriptProcessor.connect(this.audioContext.destination);

    const tick = () => {
      if (!this.audioContext) return;
      analyser.getFloatTimeDomainData(this.latestData as any);
      requestAnimationFrame(tick);
    };
    tick();
  }

  terminate() {
    this.isRecording = false;
    this.stream?.getTracks().forEach(t => t.stop());
    this.audioContext?.close();
    this.stream = null;
    this.audioContext = null;
    this.gainNode = null;
  }

  async playCurrentBuffer(onEnded?: () => void) {
    if (!this.audioContext) return;
    this.stopPlayback(); // Stop any existing audition

    const data = this.getBufferData();
    if (data.length === 0) return;

    const audioBuffer = this.audioContext.createBuffer(1, data.length, 44100);
    audioBuffer.getChannelData(0).set(data);
    
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    
    source.onended = () => {
        if (this.activeSource === source) {
            this.activeSource = null;
        }
        onEnded?.();
    };

    this.activeSource = source;
    source.start();
    return source;
  }

  stopPlayback() {
    if (this.activeSource) {
        try {
            this.activeSource.stop();
        } catch (e) {}
        this.activeSource = null;
    }
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
