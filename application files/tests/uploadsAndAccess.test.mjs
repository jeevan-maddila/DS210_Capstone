import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

async function load(relativePath) {
  const code = stripTypeScriptTypes(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), { mode: 'transform' });
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const uploads = await load('../src/lib/photoUpload.ts');
const access = await load('../src/lib/access.ts');

test('portal follows the assigned role; URL portal hints cannot change it', () => {
  for (const requested of ['admin', 'manager', 'photographer']) {
    const url = new URL('https://example.invalid/?portal=' + requested);
    assert.equal(access.publicCheckInEvent(url), null);
    assert.equal(access.portalForRole('photographer', false), 'photographer');
    assert.equal(access.portalForRole('event_manager', false), 'manager');
    assert.equal(access.portalForRole('super_admin', true), 'admin');
  }
});

test('public check-in URLs resolve independently of staff role and reject malformed IDs', () => {
  assert.equal(access.publicCheckInEvent(new URL('https://example.invalid/?checkin=evt_123')), 'evt_123');
  assert.equal(access.publicCheckInEvent(new URL('https://example.invalid/checkin/evt_123')), 'evt_123');
  assert.equal(access.publicCheckInEvent(new URL('https://example.invalid/?checkin=bad%2Fid')), null);
});

test('HEIC with an empty MIME type is converted locally before upload', async () => {
  const source = new File(['example-heic'], 'PHONE.HEIC', { lastModified: 12345 });
  const stages = [];
  const result = await uploads.preparePhoto(source, stage => stages.push(stage), async file => {
    assert.equal(file, source);
    return new Blob(['jpeg-result'], { type: 'image/jpeg' });
  });
  assert.equal(result.name, 'PHONE.jpg');
  assert.equal(result.type, 'image/jpeg');
  assert.equal(result.lastModified, source.lastModified);
  assert.equal(await result.text(), 'jpeg-result');
  assert.match(stages[0], /Converting HEIC/);
});

test('ordinary JPEG bytes are retained and missing MIME metadata is repaired', async () => {
  const original = new File(['original'], 'photo.jpg', { type: 'image/jpeg' });
  assert.equal(await uploads.preparePhoto(original), original);
  const missingType = new File(['original'], 'photo.JPG');
  const normalized = await uploads.preparePhoto(missingType);
  assert.equal(normalized.type, 'image/jpeg');
  assert.equal(await normalized.text(), 'original');
});

test('unsupported RAW and empty files fail with actionable messages', async () => {
  await assert.rejects(uploads.preparePhoto(new File(['raw'], 'camera.CR2')), /Export RAW/);
  await assert.rejects(uploads.preparePhoto(new File([], 'empty.jpg')), /empty/);
  await assert.rejects(uploads.photoHash({ size: uploads.MAX_PHOTO_BYTES + 1 }), /30 MB/);
});

test('conversion failures and oversized JPEG results fail instead of silently uploading HEIC', async () => {
  const file = new File(['heic'], 'phone.heic');
  await assert.rejects(uploads.preparePhoto(file, undefined, async () => { throw new Error('decoder failed'); }), /Export it as JPEG/);
  await assert.rejects(uploads.preparePhoto(file, undefined, async () => ({ size: uploads.MAX_PHOTO_BYTES + 1 })), /converted photo/);
});

test('duplicate fingerprints compare bytes rather than names', async () => {
  const one = await uploads.photoHash(new File(['same'], 'one.jpg'));
  const renamed = await uploads.photoHash(new File(['same'], 'different.heic'));
  const different = await uploads.photoHash(new File(['different'], 'one.jpg'));
  assert.equal(one, renamed);
  assert.notEqual(one, different);
  assert.match(one, /^[a-f0-9]{64}$/);
});
