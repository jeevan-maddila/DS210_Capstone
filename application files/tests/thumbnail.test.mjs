import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(readFileSync(new URL('../src/lib/thumbnail.ts', import.meta.url), 'utf8'), { mode: 'transform' });
const { thumbnailPosition } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const photo = (x, y, imageWidth, imageHeight) => ({ thumbnailFocus: { x, y, imageWidth, imageHeight } });

function renderedPoint(record, boxWidth = 320, boxHeight = 180) {
  const focus = record.thumbnailFocus;
  const scale = Math.max(boxWidth / focus.imageWidth, boxHeight / focus.imageHeight);
  const width = focus.imageWidth * scale, height = focus.imageHeight * scale;
  const [x, y] = thumbnailPosition(record, boxWidth / boxHeight).split(' ').map(parseFloat);
  return [focus.x * width + (boxWidth - width) * x / 100,
    focus.y * height + (boxHeight - height) * y / 100];
}

test('portrait focal point is actually centered vertically rather than percentage-aligned', () => {
  const record = photo(0.5, 0.25, 600, 900);
  const [x, y] = renderedPoint(record);
  assert.ok(Math.abs(x - 160) < 1e-6);
  assert.ok(Math.abs(y - 90) < 1e-6);
  assert.notEqual(thumbnailPosition(record), '50% 25%');
});

test('wide-photo focal point is centered horizontally', () => {
  const [x, y] = renderedPoint(photo(0.75, 0.5, 1600, 400));
  assert.ok(Math.abs(x - 160) < 1e-6);
  assert.ok(Math.abs(y - 90) < 1e-6);
});

test('edge focus clamps the crop without exposing empty space', () => {
  const [x, y] = thumbnailPosition(photo(0.5, 0.01, 600, 900)).split(' ').map(parseFloat);
  assert.equal(x, 50);
  assert.equal(y, 0);
});

test('missing, legacy, and invalid metadata stay centered', () => {
  for (const record of [{}, photo(0.2, 0.2), photo(NaN, 0.5, 100, 200), photo(0.5, 0.5, -1, 10)]) {
    assert.equal(thumbnailPosition(record), '50% 50%');
  }
});

test('an image matching the box aspect ratio cannot be panned without exposing an edge', () => {
  assert.equal(thumbnailPosition(photo(0.2, 0.1, 1600, 900)), '50% 50%');
});
