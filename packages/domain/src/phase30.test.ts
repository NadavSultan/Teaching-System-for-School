import { describe, expect, it } from 'vitest';
import {
  canTransitionSourceLifecycle,
  isEligibleKnowledgeItem,
  normalizeSourceText,
  parsePlainTextSource,
} from './index.js';

describe('Phase 30 eligibility and deterministic parsing', () => {
  const base = {
    pedagogicalApproved: true,
    usageAllowed: true,
    sourceLifecycle: 'ACTIVE' as const,
    itemLifecycle: 'ACTIVE' as const,
    visibilityPermitted: true,
    exactPublishedCurriculum: true,
  };
  it('is deny-by-default for every individual negative dimension', () => {
    expect(isEligibleKnowledgeItem(base)).toBe(true);
    for (const key of [
      'pedagogicalApproved',
      'usageAllowed',
      'visibilityPermitted',
      'exactPublishedCurriculum',
    ] as const)
      expect(isEligibleKnowledgeItem({ ...base, [key]: false })).toBe(false);
    for (const sourceLifecycle of [
      'DRAFT',
      'SUSPENDED',
      'DEPRECATED',
      'FAILED',
      'NEEDS_RE_REVIEW',
    ] as const)
      expect(isEligibleKnowledgeItem({ ...base, sourceLifecycle })).toBe(false);
    for (const itemLifecycle of ['SUSPENDED', 'DEPRECATED'] as const)
      expect(isEligibleKnowledgeItem({ ...base, itemLifecycle })).toBe(false);
  });
  it('normalizes Hebrew/plain text with stable paragraph locators', () => {
    const items = parsePlainTextSource('  שלום  עולם\r\n\r\n  זהו  קטע שני  ');
    expect(items).toEqual([
      { locator: 'paragraph:1', text: 'שלום עולם' },
      { locator: 'paragraph:2', text: 'זהו קטע שני' },
    ]);
    expect(normalizeSourceText('א\r\nב')).toBe('א\nב');
  });
  it('enforces the complete source lifecycle transition matrix', () => {
    const statuses = [
      'DRAFT',
      'ACTIVE',
      'SUSPENDED',
      'DEPRECATED',
      'FAILED',
      'NEEDS_RE_REVIEW',
    ] as const;
    const allowed: Record<(typeof statuses)[number], readonly (typeof statuses)[number][]> = {
      DRAFT: ['ACTIVE', 'SUSPENDED', 'DEPRECATED', 'FAILED', 'NEEDS_RE_REVIEW'],
      ACTIVE: ['SUSPENDED', 'DEPRECATED', 'FAILED', 'NEEDS_RE_REVIEW'],
      SUSPENDED: ['ACTIVE', 'DEPRECATED', 'FAILED', 'NEEDS_RE_REVIEW'],
      NEEDS_RE_REVIEW: ['ACTIVE', 'SUSPENDED', 'DEPRECATED', 'FAILED'],
      FAILED: ['NEEDS_RE_REVIEW', 'DEPRECATED'],
      DEPRECATED: [],
    };
    for (const from of statuses) {
      for (const to of statuses) {
        expect(canTransitionSourceLifecycle(from, to)).toBe(allowed[from].includes(to));
      }
    }
  });
});
