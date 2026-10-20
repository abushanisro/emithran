import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { ElectronicsRepository, type DesignRow } from '../infrastructure/repositories/electronics.repository';

export interface CreateContainerInput {
  itemType: 'assembly' | 'sub_assembly';
  name: string;
  projectId?: string;
  parentDesignId?: string;
  organizationId: string;
  userId: string;
  token: string;
}

// An empty Assembly or Sub-Assembly, created by hand like a BOM assembly: it holds child parts and further sub-assemblies and has no
// files of its own. An assembly is top level in a project; a sub-assembly lives inside an assembly or another sub-assembly.
@Injectable()
export class CreateContainerUseCase {
  constructor(private readonly repository: ElectronicsRepository) {}

  async execute(input: CreateContainerInput): Promise<DesignRow> {
    const name = input.name.trim();
    if (name.length === 0) throw new BadRequestException('A name is required.');

    let projectId = input.projectId ?? null;
    let parentId: string | null = null;
    if (input.itemType === 'assembly') {
      if (input.parentDesignId) throw new BadRequestException('An assembly is at the top of a project; to nest one, create a sub-assembly.');
    } else {
      if (!input.parentDesignId) throw new BadRequestException('A sub-assembly belongs inside an assembly or another sub-assembly.');
      const parent = await this.repository.getDesign(input.parentDesignId, input.token);
      if (parent.item_type === 'child_part') throw new BadRequestException('A child part cannot contain other parts.');
      parentId = parent.id;
      projectId = parent.project_id;
    }
    if (!projectId) throw new BadRequestException('An assembly belongs to a project.');
    if (!(await this.repository.projectVisible(projectId, input.organizationId, input.token))) throw new NotFoundException('Project not found');

    const twin = await this.repository.findDesignByName({ projectId, parentId, name, container: true }, input.token);
    if (twin) throw new ConflictException(`There is already an ${twin.item_type === 'assembly' ? 'assembly' : 'sub-assembly'} named "${name}" here.`);

    return this.repository.insertDesign(
      {
        organization_id: input.organizationId,
        project_id: projectId,
        parent_design_id: parentId,
        item_type: input.itemType,
        name,
        kind: 'assembly',
        created_by: input.userId,
      },
      input.token,
    );
  }
}
