import Peer from 'simple-peer';

/**
 * Handles chunked binary file transfer over WebRTC DataChannel.
 */
export class FileTransfer {
  private static CHUNK_SIZE = 16384; // 16KB safe chunk size

  private peer: Peer.Instance;
  private onProgress: (p: number) => void;

  constructor(peer: Peer.Instance, onProgress: (p: number) => void) {
    this.peer = peer;
    this.onProgress = onProgress;
  }

  async sendFile(blob: Blob, name: string = 'haze_sample.wav', slot: string = 'NOTIFICATION', isPreview: boolean = false) {
    if (!this.peer || !this.peer.connected) throw new Error("Peer not connected");
    
    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const totalChunks = Math.ceil(data.length / FileTransfer.CHUNK_SIZE);
    
    // Send Metadata first
    this.peer.send(JSON.stringify({
      type: 'file_meta',
      size: data.length,
      chunks: totalChunks,
      name,
      slot,
      is_preview: isPreview
    }));

    // Small delay to ensure meta is processed
    await new Promise(r => setTimeout(r, 100));

    for (let i = 0; i < totalChunks; i++) {
        const start = i * FileTransfer.CHUNK_SIZE;
        const end = Math.min(start + FileTransfer.CHUNK_SIZE, data.length);
        const chunk = data.slice(start, end);

        // BACKPRESSURE: If the buffer is too full, wait before sending more
        const internalChannel = (this.peer as any)._channel as RTCDataChannel;
        while (internalChannel && internalChannel.bufferedAmount > 64 * 1024) {
            await new Promise(r => setTimeout(r, 50));
        }

        this.peer.send(chunk);
        this.onProgress((i + 1) / totalChunks);
    }
  }
}
