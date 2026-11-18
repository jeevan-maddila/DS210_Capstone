import type { PhotoRecord } from '../types';

/** Center a focal point in an object-cover crop, clamped to avoid empty edges. */
export function thumbnailPosition(photo: PhotoRecord, boxAspectRatio = 16 / 9): string {
  const focus = photo.thumbnailFocus;
  if (!focus || !Number.isFinite(focus.x) || !Number.isFinite(focus.y)) return '50% 50%';
  const width = focus.imageWidth;
  const height = focus.imageHeight;
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height ||
      width <= 0 || height <= 0 || !Number.isFinite(boxAspectRatio) || boxAspectRatio <= 0) return '50% 50%';
  // Normalize the viewport to (aspect ratio, 1); only relative sizes matter.
  const scale = Math.max(boxAspectRatio / width, 1 / height);
  const position = (point: number, imageSize: number, boxSize: number) => {
    const overflow = imageSize - boxSize;
    if (overflow <= 1e-9) return '50%';
    const normalized = Math.max(0, Math.min(1, point));
    const crop = Math.max(0, Math.min(1, (normalized * imageSize - boxSize / 2) / overflow));
    return `${crop * 100}%`;
  };
  return `${position(focus.x, width * scale, boxAspectRatio)} ${position(focus.y, height * scale, 1)}`;
}
