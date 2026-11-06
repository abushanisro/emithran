import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

// Standing rule: the licensed reference-data source is never named in code, comments, migrations, docs or file names. The name is assembled here so this
// file, which enforces the rule, does not contain it.
const NAME = new RegExp('a' + 'Priori', 'i');
const ROOT = join(__dirname, '..', '..', '..', '..');

describe('the licensed source is not named in the repository', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);

  it('no tracked file name contains it', () => {
    expect(files.filter((f) => NAME.test(f))).toEqual([]);
  });

  it('no tracked text file contains it, ', () => {
    const hits = files.filter((f) => {
      if (/\.(png|jpg|jpeg|gif|ico|woff2?|zip|xlsx|docx|pdf|lock)$/i.test(f)) return false;
      try {
        return NAME.test(readFileSync(join(ROOT, f), 'utf8'));
      } catch {
        return false; // a deleted or unreadable path
      }
    });
    expect(hits).toEqual([]);
  });
});
