import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

import { ObjectExistsError } from './object-store';
import { S3ObjectStore } from './s3-object-store';

/** A tiny in-memory S3: just enough behaviour (conditional put, prefix listing, batch delete) to test our use of it. */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const send = jest.fn(async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      const { Key, Body, IfNoneMatch } = command.input;
      if (IfNoneMatch === '*' && objects.has(Key!)) throw Object.assign(new Error('precondition'), { $metadata: { httpStatusCode: 412 } });
      objects.set(Key!, Buffer.from(Body as Buffer));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const body = objects.get(command.input.Key!);
      if (!body) throw Object.assign(new Error('nope'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
      return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
    }
    if (command instanceof HeadObjectCommand) {
      if (!objects.has(command.input.Key!)) throw Object.assign(new Error('nope'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      return {};
    }
    if (command instanceof DeleteObjectsCommand) {
      for (const o of command.input.Delete!.Objects!) objects.delete(o.Key!);
      return {};
    }
    if (command instanceof ListObjectsV2Command) {
      const { Prefix } = command.input;
      const keys = [...objects.keys()].filter((k) => k.startsWith(Prefix!));
      const contents = keys.filter((k) => !k.slice(Prefix!.length).includes('/')).map((Key) => ({ Key }));
      const dirs = new Set(keys.filter((k) => k.slice(Prefix!.length).includes('/')).map((k) => Prefix! + k.slice(Prefix!.length).split('/')[0] + '/'));
      return { Contents: contents, CommonPrefixes: [...dirs].map((Prefix) => ({ Prefix })), IsTruncated: false };
    }
    throw new Error('unexpected command');
  });
  return { objects, send, client: { send } as unknown as S3Client };
}

const store = () => {
  const s3 = fakeS3();
  return { ...s3, store: new S3ObjectStore({ bucket: 'real', region: 'r', accessKeyId: 'a', secretAccessKey: 'b' }, s3.client) };
};

describe('S3ObjectStore', () => {
  it('keeps each logical bucket as a prefix inside the one real bucket', async () => {
    const { store: s, objects } = store();
    await s.put('bom-files', 'u/p/file.step', Buffer.from('x'));
    expect([...objects.keys()]).toEqual(['bom-files/u/p/file.step']);
  });

  it('round-trips bytes, and a missing key is null / false rather than an error', async () => {
    const { store: s } = store();
    await s.put('b', 'k', Buffer.from('hello'));
    expect((await s.get('b', 'k'))?.toString()).toBe('hello');
    expect(await s.exists('b', 'k')).toBe(true);
    expect(await s.get('b', 'nope')).toBeNull();
    expect(await s.exists('b', 'nope')).toBe(false);
  });

  it('refuses to overwrite unless asked (never replace a file silently), and overwrites when asked', async () => {
    const { store: s } = store();
    await s.put('b', 'k', Buffer.from('1'));
    await expect(s.put('b', 'k', Buffer.from('2'))).rejects.toBeInstanceOf(ObjectExistsError);
    await s.put('b', 'k', Buffer.from('3'), { upsert: true });
    expect((await s.get('b', 'k'))?.toString()).toBe('3');
  });

  it('removes in batches, and removing a missing key is fine', async () => {
    const { store: s } = store();
    await s.put('b', 'a', Buffer.from('1'));
    await s.remove('b', ['a', 'never-existed']);
    expect(await s.exists('b', 'a')).toBe(false);
  });

  it('lists only the names directly under a prefix (files and folders), not the whole tree', async () => {
    const { store: s } = store();
    await s.put('b', 'dir/one', Buffer.from('1'));
    await s.put('b', 'dir/two', Buffer.from('2'));
    await s.put('b', 'dir/sub/deep', Buffer.from('3'));
    await s.put('b', 'other/x', Buffer.from('4'));
    expect((await s.list('b', 'dir')).sort()).toEqual(['one', 'sub', 'two']);
  });

  it('refuses keys that could escape their bucket prefix', async () => {
    const { store: s } = store();
    await expect(s.put('b', '../other/x', Buffer.from('1'))).rejects.toThrow('invalid storage key');
    await expect(s.put('b', '/abs', Buffer.from('1'))).rejects.toThrow('invalid storage key');
    await expect(s.get('a/b', 'k')).rejects.toThrow('invalid storage key');
  });

  it('signs a download URL without sending any request', async () => {
    // A real client (no injected fake): signing is local, so nothing is sent and no network is needed.
    const s = new S3ObjectStore({ bucket: 'real', region: 'eu-west-1', accessKeyId: 'a', secretAccessKey: 'b', endpoint: 'http://minio.local:9000', forcePathStyle: true });
    const url = await s.signedGetUrl('b', 'k', 60);
    expect(url).toContain('minio.local:9000/real/b/k');
    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain('X-Amz-Expires=60');
  });
});
