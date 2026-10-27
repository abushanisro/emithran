import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { StartUploadUseCase, type StartUploadResult } from './start-upload.use-case';
import { expandArchive } from '../domain/uploads/expand-archive';
import { planAssembly, type PlanNode } from '../domain/uploads/plan-assembly';
import { validateUpload, type UploadVerdict } from '../domain/uploads/validate-upload';
import { ElectronicsRepository, type DesignRow } from '../infrastructure/repositories/electronics.repository';

export interface AssemblyFileInput {
  name: string;
  bytes: Buffer;
  /** Path inside the uploaded folder, '/'-separated, starting at the folder itself. */
  path: string;
}

export interface StartAssemblyInput {
  files: AssemblyFileInput[];
  projectId?: string;
  /** Place the uploaded folder under this container instead of at the top of the project. */
  parentDesignId?: string;
  organizationId: string;
  userId: string;
  token: string;
}

export interface StartAssemblyResult {
  /** The top item the folder became (an assembly, or a child part when the folder held a single board or harness). */
  designId: string;
  items: (StartUploadResult & { path: string })[];
  /** Files that are not an accepted type (a document format the platform does not read, system files): listed, never silently dropped. */
  skipped: { path: string; reason: string }[];
  /** Files in folders with no board or harness below them: kept out of every part rather than guessed into one. */
  unplaced: string[];
}

export interface StartArchiveInput {
  /** The uploaded .zip design pack. */
  name: string;
  bytes: Buffer;
  projectId?: string;
  parentDesignId?: string;
  /** Add the pack's files as a new revision of this child part instead of building items from its folders. */
  designId?: string;
  organizationId: string;
  userId: string;
  token: string;
}

interface Leaf {
  node: PlanNode;
  files: AssemblyFileInput[];
}

function isFeatureGraph(file: AssemblyFileInput): boolean {
  if (!file.name.toLowerCase().endsWith('.json')) return false;
  try {
    const doc: unknown = JSON.parse(file.bytes.toString('utf8'));
    return typeof doc === 'object' && doc !== null && 'contractVersion' in doc;
  } catch {
    return false;
  }
}

// A folder upload: the folder structure becomes Assembly > Sub-Assembly > Child Part (see planAssembly). Everything is checked
// before anything is created, so a bad folder leaves nothing behind. Uploading the same folder again finds the items by name
// under the same parent and adds revisions (identical files resolve to the existing revision), so it never duplicates.
@Injectable()
export class StartAssemblyUploadUseCase {
  constructor(
    private readonly repository: ElectronicsRepository,
    private readonly startUpload: StartUploadUseCase,
  ) {}

  async execute(input: StartAssemblyInput): Promise<StartAssemblyResult> {
    const skipped: StartAssemblyResult['skipped'] = [];
    const accepted: (AssemblyFileInput & { verdict: Extract<UploadVerdict, { ok: true }> })[] = [];
    for (const file of input.files) {
      const verdict = validateUpload(file.name, file.bytes);
      if (verdict.ok) accepted.push({ ...file, verdict });
      else if (verdict.code === 'unsupported_extension' || verdict.code === 'empty') skipped.push({ path: file.path, reason: verdict.message });
      else throw new BadRequestException({ code: verdict.code, message: `${file.path}: ${verdict.message}` });
    }

    const plan = planAssembly(accepted.map((f, index) => ({ index, path: f.path, identifies: !!f.verdict.role || isFeatureGraph(f) })));
    if (!plan.ok) throw new BadRequestException({ code: 'invalid_assembly_folder', message: plan.message });

    const { projectId, parent } = await this.resolveScope(input);
    const leaves = this.collectLeaves(plan.root, accepted);

    const items: StartAssemblyResult['items'] = [];
    const place = async (node: PlanNode, parentId: string | null, trail: string): Promise<DesignRow> => {
      const path = trail ? `${trail}/${node.name}` : node.name;
      if (node.itemType === 'child_part') {
        const leaf = leaves.get(node);
        if (!leaf) throw new Error(`No files were collected for ${path}`); // collectLeaves visits every child part
        const existing = await this.repository.findDesignByName({ projectId, parentId, name: node.name, container: false }, input.token);
        const result = await this.startUpload.execute({
          files: leaf.files.map((f) => ({ name: f.name, bytes: f.bytes })),
          designName: node.name,
          organizationId: input.organizationId,
          userId: input.userId,
          token: input.token,
          ...(existing ? { designId: existing.id } : { projectId, ...(parentId ? { parentDesignId: parentId } : {}) }),
        });
        items.push({ ...result, path });
        return existing ?? (await this.repository.getDesign(result.designId, input.token));
      }
      const existing = await this.repository.findDesignByName({ projectId, parentId, name: node.name, container: true }, input.token);
      const container =
        existing ??
        (await this.repository.insertDesign(
          {
            organization_id: input.organizationId,
            project_id: projectId,
            parent_design_id: parentId,
            item_type: node.itemType,
            name: node.name,
            kind: 'assembly',
            created_by: input.userId,
          },
          input.token,
        ));
      for (const child of node.children) await place(child, container.id, path);
      return container;
    };

    const top = await place(plan.root, parent?.id ?? null, '');
    return {
      designId: top.id,
      items,
      skipped,
      unplaced: plan.unplaced.map((i) => (accepted[i] as AssemblyFileInput).path),
    };
  }

  // A .zip design pack is read as the folder it was made from: unpacked here, then planned like a dropped folder, so one
  // pack of several boards becomes Assembly > Sub-Assembly > Child Parts and each board is parsed on its own. A pack sent
  // for a revision of one part adds its files (folders flattened) to that part.
  async executeArchive(input: StartArchiveInput): Promise<StartAssemblyResult | (StartUploadResult & { skipped: StartAssemblyResult['skipped'] })> {
    const verdict = validateUpload(input.name, input.bytes);
    if (!verdict.ok) throw new BadRequestException({ code: verdict.code, message: `${input.name}: ${verdict.message}` });
    const archive = expandArchive(input.name, input.bytes);
    if (!archive.ok) throw new BadRequestException({ code: archive.code, message: `${input.name}: ${archive.message}` });
    const scope = { organizationId: input.organizationId, userId: input.userId, token: input.token };

    if (input.designId) {
      const skipped = [...archive.skipped];
      const files: { name: string; bytes: Buffer }[] = [];
      const seen = new Set<string>();
      for (const entry of archive.entries) {
        const check = validateUpload(entry.name, entry.bytes);
        if (!check.ok && (check.code === 'unsupported_extension' || check.code === 'empty')) {
          skipped.push({ path: entry.path, reason: check.message });
          continue;
        }
        if (seen.has(entry.name)) {
          throw new BadRequestException({ code: 'invalid_assembly_folder', message: `${input.name}: two files are named ${entry.name}; a revision takes one set of files.` });
        }
        seen.add(entry.name);
        files.push({ name: entry.name, bytes: entry.bytes });
      }
      const result = await this.startUpload.execute({ files, designId: input.designId, ...scope });
      return { ...result, skipped };
    }

    const result = await this.execute({
      files: archive.entries,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.parentDesignId ? { parentDesignId: input.parentDesignId } : {}),
      ...scope,
    });
    return { ...result, skipped: [...archive.skipped, ...result.skipped] };
  }

  private async resolveScope(input: StartAssemblyInput): Promise<{ projectId: string; parent: DesignRow | null }> {
    let parent: DesignRow | null = null;
    let projectId = input.projectId ?? null;
    if (input.parentDesignId) {
      parent = await this.repository.getDesign(input.parentDesignId, input.token);
      if (parent.item_type === 'child_part') {
        throw new BadRequestException('A child part cannot contain other parts; choose an assembly or sub-assembly.');
      }
      projectId = parent.project_id;
    }
    if (!projectId) throw new BadRequestException({ code: 'project_required', message: 'An assembly belongs to a project.' });
    if (!(await this.repository.projectVisible(projectId, input.organizationId, input.token))) throw new NotFoundException('Project not found');
    return { projectId, parent };
  }

  // The files each child part uploads. A part read from board files takes all of its files; a part given as a feature graph
  // uploads just that graph (the engine reads board files, a graph stands alone).
  private collectLeaves(root: PlanNode, accepted: (AssemblyFileInput & { verdict: Extract<UploadVerdict, { ok: true }> })[]): Map<PlanNode, Leaf> {
    const leaves = new Map<PlanNode, Leaf>();
    const visit = (node: PlanNode) => {
      if (node.itemType !== 'child_part') { node.children.forEach(visit); return; }
      const files = node.fileIndexes.map((i) => accepted[i]);
      let chosen: AssemblyFileInput[];
      if (files.some((f) => f.verdict.role)) {
        chosen = files;
      } else {
        const graphs = files.filter((f) => isFeatureGraph(f));
        if (graphs.length !== 1) {
          throw new BadRequestException({ code: 'invalid_assembly_folder', message: `${node.name}: a part given as a feature graph needs exactly one graph file, found ${graphs.length}.` });
        }
        chosen = graphs;
      }
      const seen = new Set<string>();
      for (const f of chosen) {
        if (seen.has(f.name)) {
          throw new BadRequestException({ code: 'invalid_assembly_folder', message: `${node.name}: two files are named ${f.name}; rename one.` });
        }
        seen.add(f.name);
      }
      leaves.set(node, { node, files: chosen });
    };
    visit(root);
    return leaves;
  }
}
