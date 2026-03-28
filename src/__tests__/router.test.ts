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
  it('routes simple tasks to opencode when available (first-class local)', () => {
    const decision = routeTask('fix typo in header', { opencodeAvailable: true });
    expect(decision.buildAgent).toBe('opencode');
    expect(decision.reviewAgent).toBeUndefined();
  });

  it('routes simple tasks to aider-local when opencode unavailable', () => {
    const decision = routeTask('fix typo in header', { localAvailable: true, opencodeAvailable: false });
    expect(decision.buildAgent).toBe('aider-local');
  });

  it('routes simple tasks to openrouter when local unavailable', () => {
    const decision = routeTask('fix typo in header', { localAvailable: false, opencodeAvailable: false });
    expect(decision.buildAgent).toBe('aider-openrouter');
  });

  it('routes medium tasks to opencode with local review', () => {
    const decision = routeTask('add user login feature', { opencodeAvailable: true, localAvailable: true });
    expect(decision.buildAgent).toBe('opencode');
    expect(decision.reviewAgent).toBe('aider-local');
  });

  it('routes medium tasks to opencode with claude review when local unavailable', () => {
    const decision = routeTask('add user login feature', { 
      opencodeAvailable: true, 
      localAvailable: false,
    });
    expect(decision.buildAgent).toBe('opencode');
    expect(decision.reviewAgent).toBe('claude-code');
  });

  it('routes medium tasks to local with claude review when opencode unavailable', () => {
    const decision = routeTask('add user login feature', { 
      opencodeAvailable: false, 
      localAvailable: true,
    });
    expect(decision.buildAgent).toBe('aider-local');
    expect(decision.reviewAgent).toBe('claude-code');
  });

  it('skips review when autoReview is false', () => {
    const decision = routeTask('add user login feature', { opencodeAvailable: true, autoReview: false });
    expect(decision.buildAgent).toBe('opencode');
    expect(decision.reviewAgent).toBeUndefined();
  });

  it('routes medium tasks to openrouter when local unavailable', () => {
    const decision = routeTask('add search feature', { 
      opencodeAvailable: false,
      localAvailable: false,
    });
    expect(decision.buildAgent).toBe('aider-openrouter');
    expect(decision.reviewAgent).toBe('claude-code');
  });

  it('routes complex tasks to opencode with claude review', () => {
    const decision = routeTask('refactor the auth system', { opencodeAvailable: true });
    expect(decision.buildAgent).toBe('opencode');
    expect(decision.reviewAgent).toBe('claude-code');
  });

  it('routes complex tasks to claude when no free tier available', () => {
    const decision = routeTask('refactor the auth system', {
      opencodeAvailable: false,
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
  it('creates a single-phase plan for simple tasks with opencode', () => {
    const plan = planExecution('fix typo in readme', { opencodeAvailable: true });
    expect(plan.phase1.agent).toBe('opencode');
    expect(plan.phase2).toBeUndefined();
  });

  it('creates a two-phase plan for medium tasks with opencode', () => {
    const plan = planExecution('add search endpoint', { 
      opencodeAvailable: true,
      localAvailable: true,
    });
    expect(plan.phase1.agent).toBe('opencode');
    expect(plan.phase2).toBeDefined();
    expect(plan.phase2!.agent).toBe('aider-local');
  });

  it('creates a single-phase plan for architecture tasks', () => {
    const plan = planExecution('design the database schema from scratch');
    expect(plan.phase1.agent).toBe('claude-code');
    expect(plan.phase2).toBeUndefined();
  });
});
