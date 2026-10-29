import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';

import { ObjectExistsError } from '../../src/common/storage/object-store';
import { S3ObjectStore } from '../../src/common/storage/s3-object-store';

const endpoint = process.env.S3_TEST_ENDPOINT as string;
const settings = { bucket: 'emithran-test', region: 'us-east-1', endpoint, accessKeyId: 'test', secretAccessKey: 'testtesttest', forcePathStyle: true };
let failed = false;

async function check(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed = true;
    console.log(`FAIL ${name}  ${error instanceof Error ? error.message : String(error)}`);
  }
}
const must = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

async function main(): Promise<void> {
  await new S3Client({ region: settings.region, endpoint, forcePathStyle: true, credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } })
    .send(new CreateBucketCommand({ Bucket: settings.bucket }));
  const store = new S3ObjectStore(settings);
  const bytes = Buffer.from([0, 1, 2, 250, 255, 10, 13]);

  await check('put then get returns the same bytes (binary safe)', async () => {
    await store.put('bom-files', 'u/p/bom-items/i/3d/a.step', bytes);
    must(Buffer.compare((await store.get('bom-files', 'u/p/bom-items/i/3d/a.step')) as Buffer, bytes) === 0, 'bytes differ');
  });
  await check('a missing key is null / false, not an error', async () => {
    must((await store.get('bom-files', 'nope/x')) === null, 'get should be null');
    must((await store.exists('bom-files', 'nope/x')) === false, 'exists should be false');
  });
  await check('put without upsert refuses to overwrite (ObjectExistsError), upsert overwrites', async () => {
    await store.put('bom-files', 'dup', Buffer.from('1'));
    await store.put('bom-files', 'dup', Buffer.from('2')).then(() => must(false, 'overwrote'), (e) => must(e instanceof ObjectExistsError, `wrong error: ${e}`));
    await store.put('bom-files', 'dup', Buffer.from('3'), { upsert: true });
    must((await store.get('bom-files', 'dup'))?.toString() === '3', 'upsert did not replace');
  });
  await check('logical buckets are isolated from each other', async () => {
    await store.put('electronics-uploads', 'same-key', Buffer.from('E'));
    await store.put('bom-files', 'same-key', Buffer.from('B'));
    must((await store.get('electronics-uploads', 'same-key'))?.toString() === 'E', 'bucket leak');
  });
  await check('list shows only the names directly under a folder', async () => {
    await store.put('bom-files', 'dir/one', Buffer.from('1'));
    await store.put('bom-files', 'dir/two', Buffer.from('2'));
    await store.put('bom-files', 'dir/sub/deep', Buffer.from('3'));
    const names = (await store.list('bom-files', 'dir')).sort();
    must(JSON.stringify(names) === JSON.stringify(['one', 'sub', 'two']), `got ${JSON.stringify(names)}`);
  });
  await check('remove deletes, and removing a missing key is fine', async () => {
    await store.remove('bom-files', ['dir/one', 'dir/two', 'dir/sub/deep', 'never-existed']);
    for (const key of ['dir/one', 'dir/two', 'dir/sub/deep']) must(!(await store.exists('bom-files', key)), `${key} still exists`);
    // (SeaweedFS may still list the now-empty folder name `sub`; S3 has no folders. The objects are what matters.)
    must(!(await store.list('bom-files', 'dir')).some((n) => n === 'one' || n === 'two'), 'removed files are still listed');
  });
  await check('a signed URL downloads the object with plain HTTP and no credentials', async () => {
    await store.put('bom-files', 'signed/file.bin', bytes);
    const res = await fetch(await store.signedGetUrl('bom-files', 'signed/file.bin', 60));
    must(res.ok, `status ${res.status}`);
    must(Buffer.compare(Buffer.from(await res.arrayBuffer()), bytes) === 0, 'downloaded bytes differ');
  });
  await check('a key that tries to leave its bucket is refused before any request', async () => {
    await store.get('bom-files', '../electronics-uploads/same-key').then(() => must(false, 'accepted'), (e) => must(/invalid storage key/.test(String(e)), String(e)));
  });
  await check('a large object (12 MB) round-trips', async () => {
    const big = Buffer.alloc(12 * 1024 * 1024, 7);
    await store.put('bom-files', 'big.bin', big);
    must((await store.get('bom-files', 'big.bin'))?.length === big.length, 'size differs');
  });

  if (failed) process.exit(1);
}
void main().catch((error) => { console.log(`FAIL harness  ${error instanceof Error ? error.stack : String(error)}`); process.exit(1); });
