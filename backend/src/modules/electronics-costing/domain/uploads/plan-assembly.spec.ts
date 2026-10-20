import { planAssembly, type PlanFile, type PlanNode } from './plan-assembly';

// The first test uses a typical customer folder layout: two board folders, each with a drawing and a
// Gerber_and_PickPlace folder, and a BOM workbook and requirements document beside them.
const f = (index: number, path: string, identifies = false): PlanFile => ({ index, path, identifies });

const ROOT = 'Assembly';
const sample: PlanFile[] = [
  f(0, `${ROOT}/BoardA/Gerber_and_PickPlace/board.GTL`, true),
  f(1, `${ROOT}/BoardA/Gerber_and_PickPlace/board.GKO`, true),
  f(2, `${ROOT}/BoardA/Gerber_and_PickPlace/Pick Place for board.csv`),
  f(3, `${ROOT}/BoardA/board PCB.pdf`),
  f(4, `${ROOT}/BoardB/Gerber_and_PickPlace/boardb.GTL`, true),
  f(5, `${ROOT}/BoardB/Gerber_and_PickPlace/Pick Place for boardb.csv`),
  f(6, `${ROOT}/PCBA BOM (BoardA + BoardB).xlsx`),
  f(7, `${ROOT}/PCB Processing Requirements.docx`),
];

const names = (nodes: PlanNode[]) => nodes.map((n) => n.name);

describe('planAssembly: a typical customer folder', () => {
  const plan = planAssembly(sample);
  if (!plan.ok) throw new Error(plan.message);

  it('makes the top folder an assembly with one child part per board folder', () => {
    expect(plan.root).toMatchObject({ name: ROOT, itemType: 'assembly' });
    expect(names(plan.root.children)).toEqual(['BoardA', 'BoardB']);
    expect(plan.root.children.every((c) => c.itemType === 'child_part')).toBe(true);
  });

  it('names a board after its outer folder and keeps its drawing and its data folder together', () => {
    const fl = plan.root.children[0];
    expect([...fl.fileIndexes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 6, 7]); // own files + the folder drawing + the shared documents
  });

  it('gives every part the assembly-level documents (BOM workbook, requirements) as reference', () => {
    for (const child of plan.root.children) {
      expect(child.fileIndexes).toEqual(expect.arrayContaining([6, 7]));
    }
    expect((plan.root.children[1]).fileIndexes.sort((a, b) => a - b)).toEqual([4, 5, 6, 7]);
  });

  it('leaves nothing unplaced', () => {
    expect(plan.unplaced).toEqual([]);
  });
});

describe('planAssembly: structure', () => {
  it('makes a nested container a sub-assembly and a design directory a child part', () => {
    const plan = planAssembly([
      f(0, 'Asm/Sub/BoardA/a.GTL', true),
      f(1, 'Asm/Sub/BoardB/b.GTL', true),
      f(2, 'Asm/Harness/graph.json', true),
    ]);
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.root).toMatchObject({ name: 'Asm', itemType: 'assembly' });
    const sub = plan.root.children.find((c) => c.name === 'Sub');
    if (!sub) throw new Error('Sub was not planned');
    expect(sub.itemType).toBe('sub_assembly');
    expect(sub.children.map((c) => [c.name, c.itemType])).toEqual([['BoardA', 'child_part'], ['BoardB', 'child_part']]);
    expect(plan.root.children.find((c) => c.name === 'Harness')).toMatchObject({ itemType: 'child_part', fileIndexes: [2] });
  });

  it('treats a folder holding one board as that board, not as an assembly of one', () => {
    const plan = planAssembly([f(0, 'BoardA/Gerber/x.GTL', true), f(1, 'BoardA/Gerber/pp.csv'), f(2, 'BoardA/drawing.pdf')]);
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.root).toMatchObject({ name: 'BoardA', itemType: 'child_part' });
    expect([...plan.root.fileIndexes].sort()).toEqual([0, 1, 2]);
  });

  it('reports files of a folder with no design as unplaced instead of guessing', () => {
    const plan = planAssembly([f(0, 'Asm/BoardA/a.GTL', true), f(1, 'Asm/BoardB/b.GTL', true), f(2, 'Asm/Notes/readme.pdf')]);
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.unplaced).toEqual([2]);
  });

  it('refuses a folder with no design in it, and files that are not in one folder', () => {
    expect(planAssembly([f(0, 'Docs/bom.xlsx'), f(1, 'Docs/notes.pdf')])).toMatchObject({ ok: false });
    expect(planAssembly([f(0, 'A/x.GTL', true), f(1, 'B/y.GTL', true)])).toMatchObject({ ok: false });
    expect(planAssembly([f(0, 'x.GTL', true)])).toMatchObject({ ok: false });
    expect(planAssembly([])).toMatchObject({ ok: false });
  });

  it('does not let a directory name decide what a part is: only the files do', () => {
    const plan = planAssembly([f(0, 'Gerber/Sub assembly/x.GTL', true), f(1, 'Gerber/Sub assembly/y.GBL', true)]);
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.root.itemType).toBe('child_part');
  });
});
