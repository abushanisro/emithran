import { Injectable } from '@nestjs/common';
import type { ProcessRoutingRule, MachineCapability, RouteIssue } from '../dto/kb.dto';

@Injectable()
export class ProcessValidationService {
  validateRoute(
    processSequence: string[],
    partFamily: string,
    rules: ProcessRoutingRule[],
  ): RouteIssue[] {
    const issues: RouteIssue[] = [];
    const seq = processSequence.map((p) => p.toLowerCase().replace(/[^a-z0-9_]/g, '_'));

    const applicable = rules.filter(
      (r) => !r.applies_to_families || r.applies_to_families.length === 0 || r.applies_to_families.includes(partFamily),
    );

    for (const rule of applicable) {
      const first = rule.first_process.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const second = rule.second_process.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const firstIdx = seq.findIndex((p) => p.includes(first) || first.includes(p.split('_')[0]));
      const secondIdx = seq.findIndex((p) => p.includes(second) || second.includes(p.split('_')[0]));

      if (rule.constraint_type === 'must_precede') {
        if (firstIdx !== -1 && secondIdx !== -1 && firstIdx > secondIdx) {
          issues.push({
            ruleId: rule.id,
            ruleName: rule.rule_name,
            severity: rule.severity,
            message: rule.message,
            affectedProcesses: [rule.first_process, rule.second_process],
            suggestedFix: rule.suggested_fix ?? undefined,
          });
        }
      } else if (rule.constraint_type === 'must_follow') {
        if (firstIdx !== -1 && secondIdx !== -1 && firstIdx < secondIdx) {
          issues.push({
            ruleId: rule.id,
            ruleName: rule.rule_name,
            severity: rule.severity,
            message: rule.message,
            affectedProcesses: [rule.first_process, rule.second_process],
            suggestedFix: rule.suggested_fix ?? undefined,
          });
        }
      } else if (rule.constraint_type === 'cannot_coexist') {
        if (firstIdx !== -1 && secondIdx !== -1) {
          issues.push({
            ruleId: rule.id,
            ruleName: rule.rule_name,
            severity: rule.severity,
            message: rule.message,
            affectedProcesses: [rule.first_process, rule.second_process],
            suggestedFix: rule.suggested_fix ?? undefined,
          });
        }
      }
    }

    return issues.sort((a, b) => {
      if (a.severity === 'error' && b.severity === 'warning') return -1;
      if (a.severity === 'warning' && b.severity === 'error') return 1;
      return 0;
    });
  }

  validateMachines(
    processSequence: string[],
    machineAssignments: Record<string, string>,
    capabilities: MachineCapability[],
  ): RouteIssue[] {
    const issues: RouteIssue[] = [];
    const capsByType = new Map<string, MachineCapability[]>();
    for (const cap of capabilities) {
      const list = capsByType.get(cap.machine_type) ?? [];
      list.push(cap);
      capsByType.set(cap.machine_type, list);
    }

    for (const [process, machineType] of Object.entries(machineAssignments)) {
      const caps = capsByType.get(machineType.toLowerCase());
      if (!caps || caps.length === 0) continue;
      const proc = process.toLowerCase();
      const canDo = caps.some((c) => c.supported_processes.some((sp) => sp.toLowerCase().includes(proc) || proc.includes(sp.toLowerCase())));
      if (!canDo) {
        issues.push({
          ruleId: `machine_cap_${machineType}_${process}`,
          ruleName: 'machine_capability_check',
          severity: 'error',
          message: `Machine type "${machineType}" cannot perform "${process}" — check machine capabilities`,
          affectedProcesses: [process],
          suggestedFix: `Assign a capable machine type for "${process}"`,
        });
      }
    }

    return issues;
  }
}
