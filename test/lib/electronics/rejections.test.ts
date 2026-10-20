import { describe, expect, it } from 'vitest';

import { describeRejection } from '@/lib/electronics/rejections';

// Extensions as GET /electronics/file-formats returns them for the file-role table.
const BOARD = new Set(['gtl', 'gbl', 'gko', 'txt', 'drr', 'gd1', 'gg1']);
const file = (name: string, tooLarge = false) => ({ name, tooLarge });

describe('describeRejection (the BOM item form refused these files)', () => {
  it('points a Gerber set to the Electronics page, naming every file', () => {
    const message = describeRejection([file('board.GTL'), file('board.GKO')], BOARD, 100);
    expect(message.boardFiles).toBe(true);
    expect(message.title).toBe('These are circuit board files');
    expect(message.description).toContain('board.GTL');
    expect(message.description).toContain('board.GKO');
    expect(message.description).toContain('Electronics module');
  });

  it('treats a mixed drop as board files when any file is one', () => {
    expect(describeRejection([file('notes.docx'), file('board.DRR')], BOARD, 100).boardFiles).toBe(true);
  });

  it('says an unrelated file type is not supported, and what is', () => {
    const message = describeRejection([file('photo.png')], BOARD, 100);
    expect(message).toMatchObject({ title: 'File type not supported', boardFiles: false });
    expect(message.description).toContain('STEP');
  });

  it('says a file is too large, with the limit', () => {
    const message = describeRejection([file('big.step', true)], BOARD, 100);
    expect(message.title).toBe('File too large');
    expect(message.description).toContain('100 MB');
  });

  it('knows no board file types of its own: with an empty table nothing is a board file', () => {
    expect(describeRejection([file('x.gtl')], new Set(), 100).boardFiles).toBe(false);
  });
});
