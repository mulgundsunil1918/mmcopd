/**
 * Binary files (the supplier's Excel, the bill's picture) cross the app's IPC as base64 TEXT. In a multi-PC clinic a cabin PC sends every call to the
 * host PC as JSON, which cannot carry raw bytes — a Uint8Array would arrive as a pile of numbered fields. Text survives that trip unchanged.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function fileToBase64(file: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}

export function base64ToBlob(b64: string, mime: string): Blob {
  return new Blob([base64ToBytes(b64) as BlobPart], { type: mime });
}
