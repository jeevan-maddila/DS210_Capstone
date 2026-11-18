export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
export class PhotoUploadError extends Error {}

export function photoFormat(file: Pick<File, 'name' | 'type'>): 'heic' | 'jpeg' | 'png' | 'webp' | null {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (['heic', 'heif'].includes(extension || '') || /^image\/hei[cf](?:-sequence)?$/i.test(file.type)) return 'heic';
  if (['jpg', 'jpeg'].includes(extension || '') || file.type === 'image/jpeg') return 'jpeg';
  if (extension === 'png' || file.type === 'image/png') return 'png';
  if (extension === 'webp' || file.type === 'image/webp') return 'webp';
  return null;
}

export async function photoHash(file: File): Promise<string> {
  if (file.size > MAX_PHOTO_BYTES) throw new PhotoUploadError('This photo exceeds the 30 MB limit.');
  const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function convertHeic(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./heic.worker.ts', import.meta.url), { type: 'module' });
    const finish = (result?: Blob) => {
      clearTimeout(timer);
      worker.terminate();
      if (result?.size) resolve(result);
      else reject(new PhotoUploadError('This HEIC photo could not be converted. Export it as JPEG and try again.'));
    };
    const timer = setTimeout(() => finish(), 60000);
    worker.onmessage = (event: MessageEvent<{ blob?: Blob }>) => finish(event.data.blob);
    worker.onerror = () => finish();
    worker.postMessage(file);
  });
}

export async function preparePhoto(
  file: File,
  onStage?: (stage: string) => void,
  converter: (file: File) => Promise<Blob> = convertHeic
): Promise<File> {
  if (!file.size) throw new PhotoUploadError('This photo is empty.');
  if (file.size > MAX_PHOTO_BYTES) throw new PhotoUploadError('This photo exceeds the 30 MB limit.');
  const format = photoFormat(file);
  if (!format) throw new PhotoUploadError('Unsupported format. Use JPEG, PNG, WebP, or HEIC. Export RAW photos as JPEG first.');
  if (format === 'heic') {
    onStage?.('Converting HEIC to JPEG on this device…');
    let blob: Blob;
    try { blob = await converter(file); }
    catch { throw new PhotoUploadError('This HEIC photo could not be converted. Export it as JPEG and try again.'); }
    if (!blob.size || blob.size > MAX_PHOTO_BYTES) throw new PhotoUploadError('The converted photo is empty or exceeds 30 MB. Export a smaller JPEG.');
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  }
  const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[format];
  return file.type === mime ? file : new File([file], file.name, { type: mime, lastModified: file.lastModified });
}
