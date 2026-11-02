import { Global, Module } from '@nestjs/common';

import { AiBudgetService } from './ai-budget.service';

/** Global: every feature that calls the model injects AiBudgetService, the only holder of the Anthropic key. */
@Global()
@Module({
  providers: [AiBudgetService],
  exports: [AiBudgetService],
})
export class AiModule {}
