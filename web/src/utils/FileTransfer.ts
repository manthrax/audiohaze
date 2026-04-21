import Peer from 'simple-peer';

/**
 * Handles chunked binary file transfer over WebRTC DataChannel.
 */
export class FileTransfer {
  private static CHUNK_SIZE = 16384; // 16KB safe chunk size

  static async send(peer: Peer.Instance, data: Uint8Array, onProgress: (p: number) => void, metadata: any = {}) {
    const totalChunks = Math.ceil(data.length / FileTransfer.CHUNK_SIZE);
    
    // Send Metadata first
    peer.send(JSON.stringify({
      type: 'file_meta',
      size: data.length,
      chunks: totalChunks,
      name: 'notification.ogg',
      ...metadata
    }));

    // Small delay to ensure meta is processed
    await new Promise(r => setTimeout(r, 100));

    for (let i = 0; i < totalChunks; i++) {
        const start = i * FileTransfer.CHUNK_SIZE;
        const end = Math.min(start + FileTransfer.CHUNK_SIZE, data.length);
        const chunk = data.slice(start, end);

        // BACKPRESSURE: If the buffer is too full, wait before sending more
        // modern browsers usually have a 64KB - 256KB limit per message, 
        // but simple-peer manages the queue. We check the internal RTCDataChannel buffer.
        // Accessing the internal channel from simple-peer
        const internalChannel = (peer as any)._channel as RTCDataChannel;
        
        while (internalChannel && internalChannel.bufferedAmount > 64 * 1024) {
            await new Promise(r => setTimeout(r, 50));
        }

        peer.send(chunk);
        onProgress((i + 1) / totalChunks);
    }
  }
}
