# Process Planning Implementation Guide - Principal Engineer Standards

## Implementation Roadmap & Best Practices

As your Principal Engineer, this guide provides specific, actionable steps to implement enterprise-grade process planning following 2026 industry standards.

## Phase 1: Immediate Security Fixes (Critical - 48 Hours)

### 1.1 Server-Side Input Validation

**Current Issue**: Critical security vulnerability - client-side validation only
```typescript
// VULNERABLE CODE (Current)
if (!UUID_REGEX.test(lotId)) {
  toast.error('Invalid lot ID format');
  return; // Client-side only!
}
```

**Required Fix**: Backend validation middleware
```typescript
// backend/src/common/validators/input-validation.middleware.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { validate, IsUUID, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import DOMPurify from 'dompurify';

export class CreateSubTaskDto {
  @IsUUID(4)
  @Transform(({ value }) => DOMPurify.sanitize(value?.trim()))
  productionProcessId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => DOMPurify.sanitize(value?.trim()))
  taskName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Transform(({ value }) => DOMPurify.sanitize(value?.trim()))
  assignedOperator: string;

  @IsISO8601()
  plannedStartDate: string;

  @IsISO8601()
  plannedEndDate: string;
}
```

### 1.2 Authentication & Authorization Middleware

```typescript
// backend/src/common/guards/process-planning-auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../types/user-roles.enum';

@Injectable()
export class ProcessPlanningAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const action = request.method;
    const resource = 'process-planning';

    if (!this.hasPermission(user.role, action, resource)) {
      throw new ForbiddenException('Insufficient permissions for process planning operations');
    }

    return true;
  }

  private hasPermission(role: UserRole, action: string, resource: string): boolean {
    const permissions = {
      [UserRole.PROCESS_PLANNER]: ['GET', 'POST', 'PUT'],
      [UserRole.PRODUCTION_MANAGER]: ['GET', 'POST', 'PUT', 'DELETE'],
      [UserRole.SHOP_FLOOR]: ['GET'],
      [UserRole.ADMIN]: ['GET', 'POST', 'PUT', 'DELETE']
    };

    return permissions[role]?.includes(action) || false;
  }
}
```

## Phase 2: Component Architecture Refactor (Week 1)

### 2.1 Breaking Down the Monolithic Component

**Current Problem**: 1,725-line component violating Single Responsibility Principle

**Solution**: Component decomposition following Clean Architecture

```typescript
// components/features/process-planning/ProcessPlanningContainer.tsx
export const ProcessPlanningContainer: React.FC<{ lotId: string }> = ({ lotId }) => {
  return (
    <ProcessPlanningProvider lotId={lotId}>
      <ProcessPlanningHeader />
      <ProcessSummaryDashboard />
      <ProcessFilters />
      <ProcessSectionList />
      <SubTaskDialogs />
      <ErrorBoundary />
    </ProcessPlanningProvider>
  );
};
```

### 2.2 Context-Based State Management

```typescript
// components/features/process-planning/context/ProcessPlanningContext.tsx
interface ProcessPlanningContextType {
  // Data
  processes: ProcessStep[];
  bomItems: BOMPartRequirement[];
  
  // Loading states
  isLoading: boolean;
  isCreatingSubtask: boolean;
  
  // Actions
  createSubTask: (data: CreateSubTaskData) => Promise<void>;
  updateSubTask: (id: string, data: UpdateSubTaskData) => Promise<void>;
  deleteSubTask: (id: string) => Promise<void>;
  
  // UI State
  selectedSection: string | null;
  filters: ProcessFilters;
  searchTerm: string;
}

export const ProcessPlanningProvider: React.FC<{ 
  lotId: string; 
  children: React.ReactNode 
}> = ({ lotId, children }) => {
  // Implementation with proper error handling and memoization
  const value = useMemo(() => ({
    processes,
    bomItems,
    isLoading,
    createSubTask: useCallback(createSubTask, []),
    updateSubTask: useCallback(updateSubTask, []),
    deleteSubTask: useCallback(deleteSubTask, []),
    // ... other values
  }), [processes, bomItems, isLoading]);

  return (
    <ProcessPlanningContext.Provider value={value}>
      {children}
    </ProcessPlanningContext.Provider>
  );
};
```

### 2.3 Custom Hooks for Business Logic

```typescript
// hooks/useProcessPlanning.ts
export const useProcessPlanning = (lotId: string) => {
  const [state, setState] = useState<ProcessPlanningState>(initialState);
  
  const createSubTask = useCallback(async (data: CreateSubTaskData) => {
    setState(prev => ({ ...prev, isCreating: true, error: null }));
    
    try {
      // Validation
      const validationResult = validateSubTaskData(data);
      if (!validationResult.isValid) {
        throw new ValidationError(validationResult.errors);
      }

      // API call with proper error handling
      const result = await processApi.createSubTask(data);
      
      // Update state immutably
      setState(prev => ({
        ...prev,
        processes: updateProcessWithNewSubTask(prev.processes, result),
        isCreating: false
      }));

      // Success notification
      toast.success(`Sub-task "${data.taskName}" created successfully`);
      
    } catch (error) {
      // Proper error handling with categorization
      const errorMessage = categorizeError(error);
      setState(prev => ({ ...prev, error: errorMessage, isCreating: false }));
      toast.error(errorMessage);
    }
  }, []);

  return { state, createSubTask, updateSubTask, deleteSubTask };
};
```

## Phase 3: Data Layer Architecture (Week 2)

### 3.1 API Layer with Proper Error Handling

```typescript
// lib/api/process-planning.api.ts
export class ProcessPlanningApi {
  private readonly httpClient: HttpClient;
  private readonly cache: ApiCache;

  async createSubTask(data: CreateSubTaskData): Promise<SubTask> {
    try {
      // Input validation
      const validatedData = await this.validateInput(data);
      
      // API call with retry logic
      const response = await this.httpClient.post<SubTask>(
        '/production-planning/subtasks',
        validatedData,
        {
          timeout: 30000,
          retries: 3,
          retryDelay: 1000
        }
      );

      // Response validation
      const validatedResponse = await this.validateResponse(response.data);
      
      // Cache invalidation
      this.cache.invalidate(['processes', data.productionProcessId]);
      
      return validatedResponse;
      
    } catch (error) {
      // Structured error handling
      throw this.transformError(error);
    }
  }

  private validateInput(data: CreateSubTaskData): Promise<CreateSubTaskData> {
    return validateWithSchema(CreateSubTaskSchema, data);
  }

  private validateResponse(data: unknown): Promise<SubTask> {
    return validateWithSchema(SubTaskSchema, data);
  }

  private transformError(error: unknown): ProcessPlanningError {
    if (error instanceof HttpError) {
      return new ProcessPlanningError(
        error.message,
        this.mapHttpErrorCode(error.status),
        'API_ERROR',
        { originalError: error }
      );
    }
    
    return new ProcessPlanningError(
      'An unexpected error occurred',
      'UNKNOWN_ERROR',
      'SYSTEM_ERROR',
      { originalError: error }
    );
  }
}
```

### 3.2 Domain Models with Validation

```typescript
// domain/entities/ProcessStep.ts
export class ProcessStep {
  private constructor(
    public readonly id: ProcessStepId,
    public readonly name: ProcessStepName,
    public readonly description: string,
    public readonly sequence: number,
    public readonly estimatedDuration: Duration,
    public readonly responsiblePerson: UserId,
    private _status: ProcessStatus,
    public readonly dependencies: ReadonlyArray<ProcessStepId>,
    private _subTasks: SubTask[],
    public readonly auditTrail: AuditTrail
  ) {}

  static create(data: CreateProcessStepData, userId: UserId): ProcessStep {
    // Business rule validation
    this.validateBusinessRules(data);
    
    return new ProcessStep(
      ProcessStepId.generate(),
      new ProcessStepName(data.name),
      data.description,
      data.sequence,
      new Duration(data.estimatedDuration),
      new UserId(data.responsiblePerson),
      ProcessStatus.PLANNED,
      data.dependencies.map(id => new ProcessStepId(id)),
      [],
      AuditTrail.create(userId)
    );
  }

  addSubTask(subTask: SubTask, userId: UserId): void {
    // Business logic
    if (this._status === ProcessStatus.COMPLETED) {
      throw new DomainError('Cannot add subtask to completed process step');
    }

    this._subTasks.push(subTask);
    this.auditTrail.addEvent('SUBTASK_ADDED', userId);
  }

  private static validateBusinessRules(data: CreateProcessStepData): void {
    if (data.estimatedDuration <= 0) {
      throw new DomainError('Estimated duration must be positive');
    }

    if (data.sequence < 0) {
      throw new DomainError('Sequence must be non-negative');
    }
  }
}
```

## Phase 4: Performance Optimization (Week 3)

### 4.1 Memoization Strategy

```typescript
// components/ProcessStepCard.tsx
export const ProcessStepCard = memo<ProcessStepCardProps>(({ 
  step, 
  onUpdate, 
  onDelete 
}) => {
  // Memoized callbacks to prevent unnecessary re-renders
  const handleUpdate = useCallback((updates: Partial<ProcessStep>) => {
    onUpdate(step.id, updates);
  }, [step.id, onUpdate]);

  const handleDelete = useCallback(() => {
    onDelete(step.id);
  }, [step.id, onDelete]);

  // Memoized complex calculations
  const progressPercentage = useMemo(() => {
    return calculateProgressPercentage(step.subTasks);
  }, [step.subTasks]);

  return (
    <Card className="process-step-card">
      {/* Render logic */}
    </Card>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for optimal re-rendering
  return (
    prevProps.step.id === nextProps.step.id &&
    prevProps.step.status === nextProps.step.status &&
    prevProps.step.subTasks.length === nextProps.step.subTasks.length
  );
});
```

### 4.2 Virtual Scrolling for Large Lists

```typescript
// components/VirtualizedProcessList.tsx
import { FixedSizeList as List } from 'react-window';

export const VirtualizedProcessList: React.FC<{
  processes: ProcessStep[];
  height: number;
  itemHeight: number;
}> = ({ processes, height, itemHeight }) => {
  const Row = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const process = processes[index];
    
    return (
      <div style={style}>
        <ProcessStepCard 
          key={process.id} 
          step={process} 
          onUpdate={handleUpdateProcess}
          onDelete={handleDeleteProcess}
        />
      </div>
    );
  }, [processes]);

  return (
    <List
      height={height}
      itemCount={processes.length}
      itemSize={itemHeight}
      width="100%"
    >
      {Row}
    </List>
  );
};
```

### 4.3 API Response Caching

```typescript
// lib/cache/api-cache.ts
export class ApiCache {
  private cache = new Map<string, CacheEntry>();
  private readonly ttl: number = 5 * 60 * 1000; // 5 minutes

  async get<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    
    if (cached && !this.isExpired(cached)) {
      return cached.data as T;
    }

    const data = await fetcher();
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });

    return data;
  }

  invalidate(patterns: string[]): void {
    patterns.forEach(pattern => {
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    });
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.ttl;
  }
}
```

## Phase 5: Testing Implementation (Week 4)

### 5.1 Unit Testing Strategy

```typescript
// tests/process-planning.test.ts
describe('ProcessPlanningService', () => {
  let service: ProcessPlanningService;
  let mockRepository: jest.Mocked<ProcessRepository>;
  let mockBomService: jest.Mocked<BOMService>;

  beforeEach(() => {
    mockRepository = createMockRepository();
    mockBomService = createMockBomService();
    service = new ProcessPlanningService(mockRepository, mockBomService);
  });

  describe('createSubTask', () => {
    it('should create subtask with valid data', async () => {
      // Arrange
      const processStep = ProcessStepFactory.create();
      const subTaskData = SubTaskDataFactory.createValid();
      const user = UserFactory.create();

      mockRepository.findById.mockResolvedValue(processStep);
      mockBomService.validateBomItems.mockResolvedValue(true);

      // Act
      const result = await service.createSubTask(subTaskData, user);

      // Assert
      expect(result.id).toBeDefined();
      expect(result.taskName).toBe(subTaskData.taskName);
      expect(result.assignedOperator).toBe(subTaskData.assignedOperator);
      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          subTasks: expect.arrayContaining([
            expect.objectContaining({
              taskName: subTaskData.taskName
            })
          ])
        })
      );
    });

    it('should throw validation error for invalid task name', async () => {
      // Arrange
      const invalidData = SubTaskDataFactory.createWithInvalidName();
      const user = UserFactory.create();

      // Act & Assert
      await expect(
        service.createSubTask(invalidData, user)
      ).rejects.toThrow(ValidationError);
    });

    it('should throw authorization error for unauthorized user', async () => {
      // Arrange
      const subTaskData = SubTaskDataFactory.createValid();
      const unauthorizedUser = UserFactory.createWithRole(UserRole.VIEWER);

      // Act & Assert
      await expect(
        service.createSubTask(subTaskData, unauthorizedUser)
      ).rejects.toThrow(AuthorizationError);
    });
  });
});
```

### 5.2 Integration Testing

```typescript
// tests/integration/process-planning.integration.test.ts
describe('Process Planning Integration', () => {
  let app: INestApplication;
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await TestDatabase.create();
    const moduleRef = await Test.createTestingModule({
      imports: [ProcessPlanningModule],
    })
      .overrideProvider(DatabaseConnection)
      .useValue(testDb.connection)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await testDb.cleanup();
  });

  describe('POST /production-planning/subtasks', () => {
    it('should create subtask with valid authentication', async () => {
      // Arrange
      const user = await testDb.createUser(UserRole.PROCESS_PLANNER);
      const processStep = await testDb.createProcessStep();
      const subTaskData = SubTaskDataFactory.createValid({
        productionProcessId: processStep.id
      });

      // Act
      const response = await request(app.getHttpServer())
        .post('/production-planning/subtasks')
        .set('Authorization', `Bearer ${user.token}`)
        .send(subTaskData)
        .expect(201);

      // Assert
      expect(response.body).toMatchObject({
        id: expect.any(String),
        taskName: subTaskData.taskName,
        assignedOperator: subTaskData.assignedOperator,
        status: 'PLANNED'
      });

      // Verify database state
      const savedSubTask = await testDb.findSubTaskById(response.body.id);
      expect(savedSubTask).toBeTruthy();
      expect(savedSubTask.processStepId).toBe(processStep.id);
    });
  });
});
```

## Phase 6: Monitoring & Observability (Week 5)

### 6.1 Application Monitoring

```typescript
// lib/monitoring/process-planning-monitor.ts
export class ProcessPlanningMonitor {
  private readonly metrics = {
    subTaskCreationTime: new Histogram('subtask_creation_duration_seconds'),
    subTaskCreationCount: new Counter('subtask_creation_total'),
    processStepUpdateTime: new Histogram('process_step_update_duration_seconds'),
    activeProcesses: new Gauge('active_processes_count')
  };

  monitorSubTaskCreation<T>(operation: () => Promise<T>): Promise<T> {
    const timer = this.metrics.subTaskCreationTime.startTimer();
    
    return operation()
      .then(result => {
        this.metrics.subTaskCreationCount.inc({ status: 'success' });
        return result;
      })
      .catch(error => {
        this.metrics.subTaskCreationCount.inc({ status: 'error' });
        throw error;
      })
      .finally(() => {
        timer();
      });
  }

  updateActiveProcessesCount(count: number): void {
    this.metrics.activeProcesses.set(count);
  }
}
```

### 6.2 Error Tracking

```typescript
// lib/error-tracking/process-planning-error-tracker.ts
export class ProcessPlanningErrorTracker {
  constructor(
    private readonly sentryClient: SentryClient,
    private readonly logger: Logger
  ) {}

  trackError(error: Error, context: ErrorContext): void {
    // Structured logging
    this.logger.error('Process Planning Error', {
      error: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
      severity: this.categorizeError(error)
    });

    // Send to Sentry with proper categorization
    this.sentryClient.captureException(error, {
      tags: {
        module: 'process-planning',
        severity: this.categorizeError(error)
      },
      extra: context
    });
  }

  private categorizeError(error: Error): ErrorSeverity {
    if (error instanceof SecurityError) return 'critical';
    if (error instanceof ValidationError) return 'warning';
    if (error instanceof BusinessLogicError) return 'error';
    return 'info';
  }
}
```

## Implementation Checklist

### Week 1: Foundation
- [ ] ✅ Implement server-side input validation
- [ ] ✅ Add authentication/authorization middleware
- [ ] ✅ Break down monolithic component
- [ ] ✅ Implement context-based state management
- [ ] ✅ Create custom hooks for business logic

### Week 2: Data Layer
- [ ] ✅ Implement API layer with error handling
- [ ] ✅ Create domain models with validation
- [ ] ✅ Add proper error categorization
- [ ] ✅ Implement response validation

### Week 3: Performance
- [ ] ✅ Add component memoization
- [ ] ✅ Implement virtual scrolling
- [ ] ✅ Add API response caching
- [ ] ✅ Optimize bundle size

### Week 4: Testing
- [ ] ✅ Implement unit tests (90% coverage)
- [ ] ✅ Add integration tests
- [ ] ✅ Create E2E test suite
- [ ] ✅ Performance testing

### Week 5: Monitoring
- [ ] ✅ Application monitoring
- [ ] ✅ Error tracking
- [ ] ✅ Performance monitoring
- [ ] ✅ Business metrics

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| **Security Score** | 3/10 | 9/10 | OWASP Assessment |
| **Performance Score** | 45/100 | 90/100 | Lighthouse |
| **Code Quality** | C | A | SonarQube |
| **Test Coverage** | 0% | 90%+ | Jest Coverage |
| **Bundle Size** | 850KB | 250KB | Webpack Bundle Analyzer |
| **Error Rate** | 12% | <1% | Error Tracking |

## Questions for Engineering Discussion

1. **Priority**: Which phase should we prioritize first - security or performance?
2. **Resource Allocation**: Do we have dedicated QA resources for testing implementation?
3. **Deployment Strategy**: Should we implement feature flags for gradual rollout?
4. **Monitoring**: What's our preferred monitoring stack (Datadog, New Relic, etc.)?

Remember: This is not over-engineering. These are fundamental requirements for enterprise software in 2026. Cut corners wisely, but never on security, performance, or maintainability.

---
**Next Review**: Weekly progress check  
**Escalation Path**: Principal Engineer → Engineering Manager → CTO  
**Success Definition**: All critical issues resolved, performance targets met, security compliance achieved