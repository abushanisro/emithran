function load(value: string | undefined) {
  const before = process.env.MAX_UPLOAD_MB;
  if (value === undefined) delete process.env.MAX_UPLOAD_MB;
  else process.env.MAX_UPLOAD_MB = value;
  let limits!: typeof import('./upload-limits');
  jest.isolateModules(() => {
    limits = require('./upload-limits');
  });
  if (before === undefined) delete process.env.MAX_UPLOAD_MB;
  else process.env.MAX_UPLOAD_MB = before;
  return limits;
}

describe('upload limits', () => {
  it('default to the free tier object cap of 50 MB', () => {
    expect(load(undefined).MAX_CAD_FILE_BYTES).toBe(50 * 1024 * 1024);
  });

  it('follow MAX_UPLOAD_MB, so a paid plan is a config change', () => {
    const limits = load('100');
    expect(limits.MAX_UPLOAD_MB).toBe(100);
    expect(limits.MAX_CAD_FILE_BYTES).toBe(100 * 1024 * 1024);
    expect(limits.MAX_ARCHIVE_EXPANDED_BYTES).toBe(800 * 1024 * 1024);
  });

  it('ignore a value that is not a positive number instead of disabling the limit', () => {
    for (const bad of ['', 'abc', '0', '-5']) expect(load(bad).MAX_UPLOAD_MB).toBe(50);
  });
});
