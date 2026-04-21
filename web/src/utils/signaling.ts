import { zlibSync, unzlibSync } from 'fflate';

/**
 * Strips non-essential lines from SDP to reduce payload size for QR codes.
 */
export function stripSDP(sdp: string): string {
  return sdp;
}

/**
 * Encodes a JSON signal (containing SDP/Type) into a QR-friendly string.
 */
export function encodeSignal(signal: any): string {
  // Strip SDP if present to save space
  const processedSignal = { ...signal };
  if (processedSignal.sdp) {
    processedSignal.sdp = stripSDP(processedSignal.sdp);
  }

  const jsonString = JSON.stringify(processedSignal);
  const data = new TextEncoder().encode(jsonString);
  const compressed = zlibSync(data, { level: 9 });
  
  // Efficiently convert Uint8Array to Base64
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(compressed))));
}

/**
 * Decodes a QR-scanned string back into a signal object.
 */
export function decodeSignal(encoded: string): any {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  
  const decompressed = unzlibSync(bytes);
  const jsonString = new TextDecoder().decode(decompressed);
  return JSON.parse(jsonString);
}

/**
 * Generates the FluxSound URI
 */
export function toFluxUri(encoded: string): string {
  return `flux://${encoded}`;
}

/**
 * Parses the FluxSound URI
 */
export function fromFluxUri(uri: string): string {
  return uri.replace('flux://', '');
}
