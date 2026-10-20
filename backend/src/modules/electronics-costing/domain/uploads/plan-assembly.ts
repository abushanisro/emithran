// Turns an uploaded folder into an assembly structure, the way the BOM tree is organised: Assembly > Sub-Assembly > Child Part.
// Pure: relative paths in, a tree of files out. The rules are structural only (no file or folder is classified by its name):
//
//  - a directory that directly holds a file that identifies a design (a board-file role, or a feature graph) is a design
//    directory: it becomes a Child Part with every file under it;
//  - a directory above design directories is a container: the top one is the Assembly, any other is a Sub-Assembly;
//  - a container with exactly one child, and that child a Child Part, is that part (a board folder holding one Gerber
//    folder and its drawing is one board, named after the outer folder);
//  - files in a container (a BOM workbook, a requirements document) belong to every part below it, as reference documents;
//  - a directory with no design below it is not an item; its files are reported as unplaced, never guessed into a part.

export type ItemType = 'assembly' | 'sub_assembly' | 'child_part';

export interface PlanFile {
  /** Position in the upload, so the caller can map the plan back to the bytes. */
  index: number;
  /** Relative path with '/' separators, no leading slash. */
  path: string;
  /** True when this file alone says what a design is (a Gerber/drill/report role, or a feature graph). */
  identifies: boolean;
}

export interface PlanNode {
  name: string;
  itemType: ItemType;
  children: PlanNode[];
  /** For a Child Part: the files it uploads (its own, and the reference documents of the containers above it). Empty for containers. */
  fileIndexes: number[];
}

export type AssemblyPlan = { ok: true; root: PlanNode; unplaced: number[] } | { ok: false; message: string };

interface Dir {
  name: string;
  own: number[];
  children: Map<string, Dir>;
}

function newDir(name: string): Dir {
  return { name, own: [], children: new Map() };
}

function allFiles(dir: Dir): number[] {
  return [...dir.own, ...[...dir.children.values()].flatMap(allFiles)];
}

export function planAssembly(files: PlanFile[]): AssemblyPlan {
  if (files.length === 0) return { ok: false, message: 'The folder has no files.' };

  const rootNames = new Set(files.map((f) => f.path.split('/')[0]));
  if (rootNames.size !== 1 || files.some((f) => !f.path.includes('/'))) {
    return { ok: false, message: 'Upload one folder at a time, with every file inside it.' };
  }

  const identifies = new Map(files.map((f) => [f.index, f.identifies]));
  const root = newDir([...rootNames][0]);
  for (const file of files) {
    const segments = file.path.split('/');
    let dir = root;
    for (const name of segments.slice(1, -1)) {
      let next = dir.children.get(name);
      if (!next) {
        next = newDir(name);
        dir.children.set(name, next);
      }
      dir = next;
    }
    dir.own.push(file.index);
  }

  const used = new Set<number>();
  const build = (dir: Dir, inherited: number[]): PlanNode | null => {
    if (dir.own.some((i) => identifies.get(i))) {
      const fileIndexes = [...allFiles(dir), ...inherited];
      allFiles(dir).forEach((i) => used.add(i));
      return { name: dir.name, itemType: 'child_part', children: [], fileIndexes };
    }
    const reference = [...inherited, ...dir.own];
    const children = [...dir.children.values()].map((child) => build(child, reference)).filter((n): n is PlanNode => n !== null);
    if (children.length === 0) return null;
    const only = children[0];
    if (children.length === 1 && only?.itemType === 'child_part') {
      // The folder is the part: its own files (a drawing) travel with it.
      dir.own.forEach((i) => used.add(i));
      return { ...only, name: dir.name, fileIndexes: [...new Set([...only.fileIndexes, ...dir.own])] };
    }
    dir.own.forEach((i) => used.add(i));
    return { name: dir.name, itemType: 'sub_assembly', children, fileIndexes: [] };
  };

  const top = build(root, []);
  if (!top) {
    return { ok: false, message: 'No board or wire harness found in the folder: a board needs its Gerber or drill files, a harness its feature graph.' };
  }
  if (top.itemType === 'sub_assembly') top.itemType = 'assembly';
  const unplaced = files.map((f) => f.index).filter((i) => !used.has(i));
  return { ok: true, root: top, unplaced };
}
