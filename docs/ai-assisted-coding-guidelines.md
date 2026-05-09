# AI-Assisted Coding Guidelines

## Two Ways to Vibe-Code Responsibly

As outlined in Anthropic's guidance, there are two viable approaches to AI-assisted coding for production-ready projects in 2025. The key is learning to distinguish between tasks that work well asynchronously versus those requiring synchronous supervision.

## 1. Fast Prototyping with Auto-Accept Mode

**When to use:** Peripheral features, exploratory work, scaffolding generation

**Process:**
- Describe expected output clearly
- Provide detailed specifications
- Let AI run autonomously
- Review thoroughly before session end
- Adjust and iterate as needed

**Best suited for:**
- ✅ Topics you're unfamiliar with
- ✅ Test scaffolding generation (but always review meaningfulness)
- ✅ Exploring new libraries or frameworks
- ✅ Prototype development
- ✅ Non-critical feature exploration

**Warning:** Even in auto-accept mode, generated tests must be reviewed for meaningful coverage. A passing test that doesn't validate behavior is just a false positive.

## 2. Synchronous Coding for Core Features

**When to use:** Core business logic, critical fixes, production features

**Process:**
- Every AI suggestion becomes a decision point
- Accept or iterate at each small step
- Maintain close oversight throughout
- Correct direction early before drift occurs

**Philosophy:** "It's always easier to straighten a sapling than a grown tree"

**Best suited for:**
- ✅ Core business logic
- ✅ Critical bug fixes
- ✅ Security-sensitive features
- ✅ Performance-critical code
- ✅ API design and architecture

## Session Planning Best Practices

### Start Every Session with a Clear Plan
1. **Read the plan carefully** - Don't validate unless you fully agree
2. **The plan is the seed** - Bad seed, bad soil, no fruit
3. **Lock down good concepts early** - Better architecture leads to better AI suggestions
4. **Define success criteria** before starting implementation

### Architecture Considerations
- Follow established patterns in the codebase
- Maintain separation of concerns
- Consider long-term maintainability
- Ensure proper abstraction layers

## The Vibe-Coding Quality Checklist

Before pushing any AI-generated code, verify:

### ✅ Architecture Check
- [ ] Follows established patterns in our codebase
- [ ] Maintains proper separation of concerns
- [ ] Uses existing utilities and libraries
- [ ] Consistent with coding conventions

### ✅ Security Review
- [ ] All resources properly scoped to users
- [ ] Input validation implemented
- [ ] No hardcoded secrets or credentials
- [ ] Proper authentication/authorization checks
- [ ] SQL injection and XSS prevention

### ✅ Tests
- [ ] Actually test meaningful behavior
- [ ] Cover critical paths and edge cases
- [ ] Fast and maintainable
- [ ] Clear test names describing scenarios
- [ ] No false positives

### ✅ Documentation
- [ ] Will I understand this in 6 months?
- [ ] Complex logic is well-commented
- [ ] API interfaces are documented
- [ ] Business logic reasoning is clear

### ✅ Error Handling
- [ ] Edge cases are covered
- [ ] Graceful degradation implemented
- [ ] Proper error messages for users
- [ ] Logging for debugging

### ✅ Performance
- [ ] No obvious N+1 queries
- [ ] Efficient algorithms chosen
- [ ] Database queries optimized
- [ ] Memory usage reasonable
- [ ] Caching strategy appropriate

### ✅ Knowledge Transfer
- [ ] Understand the new code before moving on
- [ ] Document any new patterns or approaches
- [ ] Share learnings with the team
- [ ] Update relevant documentation

## Implementation Guidelines

### For This Codebase Specifically

**Current Architecture Patterns:**
- Supabase authentication with JWT tokens
- Row Level Security (RLS) for authorization
- NestJS backend with proper guards
- React context for state management
- TypeScript for type safety

**Key Files to Understand:**
- `lib/providers/supabase-auth-provider.tsx:21` - Auth implementation
- `backend/src/common/guards/supabase-auth.guard.ts` - Backend security
- Database RLS policies in PostgreSQL

**Security Requirements:**
- All API calls must validate user authorization
- Database queries protected by RLS policies
- No client-side secrets
- Proper error handling without information leakage

## Red Flags to Watch For

### During AI-Assisted Development
- Overly complex solutions for simple problems
- Ignoring existing patterns and utilities
- Missing error handling
- Hardcoded values instead of configuration
- Bypassing security measures
- Tests that don't actually test behavior
- Comments that explain "what" instead of "why"

### Post-Development Review
- Code you don't understand
- Missing documentation for complex logic
- Performance bottlenecks
- Security vulnerabilities
- Breaking existing functionality
- Technical debt accumulation

## Continuous Improvement

### After Each Session
1. **Review what was accomplished** against the original plan
2. **Document any new patterns** or architectural decisions
3. **Update guidelines** based on lessons learned
4. **Share knowledge** with team members
5. **Plan next steps** for ongoing development

### Regular Assessment
- Track code quality metrics
- Monitor production performance
- Gather team feedback on AI-assisted development
- Update guidelines based on experience
- Refine the balance between auto-accept and synchronous modes

## Remember

AI is a powerful tool, but **you remain responsible** for the code that goes to production. The goal is to amplify your capabilities while maintaining quality, security, and maintainability standards.

**Golden Rule:** Never push code you don't understand or can't maintain.