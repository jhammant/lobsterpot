import { describe, it, expect } from 'vitest';
import { classifyTask, routeTask, buildReviewPrompt, planExecution, type RouterConfig } from '../router.js';

describe('classifyTask', () => {
  it('classifies architecture-level tasks', () => {
    expect(classifyTask('design system for the dashboard')).toBe('architecture');
    expect(classifyTask('architect the new API layer')).toBe('architecture');
    expect(classifyTask('database schema migration plan')).toBe('architecture');
    expect(classifyTask('build a microservices platform from scratch')).toBe('architecture');
  });

  it('classifies complex tasks', () => {
    expect(classifyTask('refactor the auth module')).toBe('complex');
    expect(classifyTask('debug complex race condition in worker pool')).toBe('complex');
    expect(classifyTask('fix the memory leak in the connection handler')).toBe('complex');
    expect(classifyTask('optimize the payment flow')).toBe('complex');
  });

  it('classifies simple tasks', () => {
    expect(classifyTask('fix typo in README')).toBe('simple');
    expect(classifyTask('rename the variable to camelCase')).toBe('simple');
    expect(classifyTask('add comment explaining the function')).toBe('simple');
    expect(classifyTask('remove unused imports')).toBe('simple');
  });

  it('defaults to medium for ambiguous tasks', () => {
    expect(classifyTask('add user login feature')).toBe('medium');
    expect(classifyTask('implement the search endpoint')).toBe('medium');
    expect(classifyTask('write unit tests for the service')).toBe('medium');
  });
});

describe('routeTask', () => {
  it('routes simple tasks to local model without review', () => {
    const decision = routeTask('fix typo in header');
    expect(decision.buildAgent).toBe('aider-local');
    expect(decision.reviewAgent).toBeUndefined();
    expect(decision.estimatedCost).toBe('$0.00');
  });

  it('routes simple tasks to openrouter when local unavailable', () => {
    const decision = routeTask('fix typo in header', { localAvailable: false });
    expect(decision.buildAgent).toBe('aider-openrouter');
  });

  it('routes medium tasks to local with claude review', () => {
    const decision = routeTask('add user login feature');
    expect(decision.buildAgent).toBe('aider-local');
    expect(decision.reviewAgent).toBe('claude-code');
  });

  it('skips review when autoReview is false', () => {
    const decision = routeTask('add user login feature', { autoReview: false });
    expect(decision.buildAgent).toBe('aider-local');
    expect(decision.reviewAgent).toBeUndefined();
  });

  it('routes medium tasks to openrouter when local unavailable', () => {
    const decision = routeTask('add search feature', { localAvailable: false });
    expect(decision.buildAgent).toBe('aider-openrouter');
    expect(decision.reviewAgent).toBe('claude-code');
  });

  it('routes complex tasks to local with claude review', () => {
    const decision = routeTask('refactor the auth system');
    expect(decision.buildAgent).toBe('aider-local');
    expect(decision.reviewAgent).toBe('claude-code');
  });

  it('routes complex tasks to claude when no free tier available', () => {
    const decision = routeTask('refactor the auth system', {
      localAvailable: false,
      openrouterAvailable: false,
    });
    expect(decision.buildAgent).toBe('claude-code');
    expect(decision.reviewAgent).toBe('claude-code');
  });

  it('routes architecture tasks directly to claude', () => {
    const decision = routeTask('architect the new microservices platform');
    expect(decision.buildAgent).toBe('claude-code');
    expect(decision.reviewAgent).toBeUndefined();
  });
});

describe('buildReviewPrompt', () => {
  it('includes the task and mentions review criteria', () => {
    const prompt = buildReviewPrompt('add login', 'some diff output');
    expect(prompt).toContain('add login');
    expect(prompt).toContain('Correctness');
    expect(prompt).toContain('Security');
    expect(prompt).toContain('APPROVED');
  });
});

describe('planExecution', () => {
  it('creates a single-phase plan for simple tasks', () => {
    const plan = planExecution('fix typo in readme');
    expect(plan.phase1.agent).toBe('aider-local');
    expect(plan.phase2).toBeUndefined();
  });

  it('creates a two-phase plan for medium tasks', () => {
    const plan = planExecution('add search endpoint');
    expect(plan.phase1.agent).toBe('aider-local');
    expect(plan.phase2).toBeDefined();
    expect(plan.phase2!.agent).toBe('claude-code');
    expect(plan.phase2!.triggerOn).toBe('completion');
  });

  it('creates a single-phase plan for architecture tasks', () => {
    const plan = planExecution('design the database schema from scratch');
    expect(plan.phase1.agent).toBe('claude-code');
    expect(plan.phase2).toBeUndefined();
  });
});
