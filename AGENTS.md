# Principal Engineer Code Review Guidelines

## Review Philosophy

Code reviews are opportunities for knowledge sharing, quality assurance, and team growth. Approach reviews as a collaborative effort to improve the codebase and mentor engineers.

## Pre-Review Checklist

### Author Responsibilities
- [ ] Code is self-tested and passes all existing tests
- [ ] PR description explains the WHY, not just the WHAT
- [ ] Code follows established patterns and conventions
- [ ] Dependencies are justified and necessary
- [ ] Breaking changes are clearly documented
- [ ] Performance impact is considered and documented

## Review Criteria

### 1. Correctness
- [ ] Logic is sound and handles edge cases
- [ ] Error handling is comprehensive
- [ ] Input validation is appropriate
- [ ] Race conditions and concurrency issues are addressed
- [ ] Security vulnerabilities are avoided

### 2. Design & Architecture
- [ ] Code follows SOLID principles
- [ ] Abstractions are appropriate and not over-engineered
- [ ] Separation of concerns is clear
- [ ] Dependencies point in the right direction
- [ ] Interface design is clean and intuitive

### 3. Performance
- [ ] No obvious performance bottlenecks
- [ ] Database queries are optimized
- [ ] Memory usage is reasonable
- [ ] Caching strategy is appropriate
- [ ] Async operations are handled correctly

### 4. Readability & Maintainability
- [ ] Code is self-documenting
- [ ] Variable and function names are clear
- [ ] Comments explain WHY, not WHAT
- [ ] Code structure follows team conventions
- [ ] Complex logic is well-documented

### 5. Testing
- [ ] Unit tests cover critical paths
- [ ] Integration tests verify system behavior
- [ ] Edge cases are tested
- [ ] Test names clearly describe scenarios
- [ ] Tests are maintainable and fast

### 6. Security
- [ ] Input sanitization is performed
- [ ] Authentication and authorization are correct
- [ ] Sensitive data is handled properly
- [ ] SQL injection and XSS are prevented
- [ ] Secrets are not hardcoded

### 7. Observability
- [ ] Logging is appropriate and structured
- [ ] Metrics are added for key operations
- [ ] Error tracking is implemented
- [ ] Debugging information is available
- [ ] Performance monitoring is considered

## Review Process

### 1. First Pass - High Level
- Understand the problem being solved
- Review the overall approach and architecture
- Identify any fundamental design issues

### 2. Second Pass - Implementation Details
- Check logic correctness
- Review error handling
- Verify test coverage
- Examine performance implications

### 3. Third Pass - Code Quality
- Review naming and readability
- Check documentation and comments
- Verify adherence to conventions
- Consider maintainability

## Feedback Guidelines

### Effective Feedback
- Be specific and actionable
- Explain the reasoning behind suggestions
- Distinguish between must-fix and nice-to-have
- Offer solutions, not just problems
- Ask questions to understand context

### Feedback Categories
- **🚫 Blocking**: Must be fixed before merge
- **⚠️ Important**: Should be addressed
- **💡 Suggestion**: Consider for improvement
- **❓ Question**: Seeking clarification
- **👍 Praise**: Acknowledge good practices

### Example Comments
```
🚫 This function doesn't handle null inputs, which could cause NPE in production.
Suggestion: Add null checks or use Optional<T>.

💡 Consider using a builder pattern here for better readability when creating 
complex objects with many parameters.

❓ Why did you choose this algorithm over the standard library implementation?
Is there a specific performance requirement?

👍 Excellent error handling here - clear messages and proper exception types.
```

## Common Anti-Patterns to Flag

### Code Smells
- Functions longer than 50 lines
- Classes with too many responsibilities
- Deep nesting (>3 levels)
- Duplicated code
- Magic numbers and strings
- Long parameter lists

### Architecture Issues
- Circular dependencies
- Tight coupling
- Inappropriate abstraction layers
- Missing error boundaries
- Synchronous calls to external services

### Performance Issues
- N+1 query problems
- Unnecessary object creation in loops
- Blocking operations on main thread
- Memory leaks
- Inefficient algorithms

## Special Considerations

### Legacy Code Integration
- Ensure new code doesn't worsen existing technical debt
- Document any workarounds for legacy constraints
- Plan incremental improvements where possible

### Breaking Changes
- Require explicit approval from team leads
- Document migration path
- Consider backward compatibility options
- Plan rollout strategy

### Security-Critical Code
- Require additional security-focused reviewers
- Perform threat modeling if needed
- Document security assumptions
- Consider penetration testing

## Post-Review Actions

### After Approval
- Monitor deployment metrics
- Watch for error rates and performance regressions
- Follow up on any production issues
- Document lessons learned

### Continuous Improvement
- Track review metrics (time to review, defect rates)
- Retrospect on review effectiveness
- Update guidelines based on team learning
- Share knowledge from reviews across the team