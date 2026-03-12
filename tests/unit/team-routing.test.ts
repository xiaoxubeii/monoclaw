import { describe, expect, it } from 'vitest';
import { routeRole } from '@electron/team/routing';
import type { TeamRoleDefinition } from '@electron/team/types';

const roles: TeamRoleDefinition[] = [
  {
    id: 'manager',
    name: 'Manager',
    personality: 'Lead',
    responsibilities: ['coordinate work', 'final summary'],
    boundaries: ['no guessing'],
    keywords: ['plan', 'summary'],
    enabled: true,
  },
  {
    id: 'analyst',
    name: 'Data Analyst',
    personality: 'Data first',
    responsibilities: ['analyze metrics', 'build funnel insights'],
    boundaries: ['no production write'],
    keywords: ['data', 'metric', 'funnel', 'conversion'],
    enabled: true,
  },
  {
    id: 'writer',
    name: 'Copy Writer',
    personality: 'Creative',
    responsibilities: ['draft copy', 'optimize headline'],
    boundaries: ['no legal claim'],
    keywords: ['copy', 'headline', 'campaign'],
    enabled: false,
  },
];

describe('team role routing', () => {
  it('routes explicitly by requested role id', () => {
    const routed = routeRole(roles, 'please handle this', 'analyst');
    expect(routed.mode).toBe('explicit');
    expect(routed.role.id).toBe('analyst');
  });

  it('routes explicitly by @mention', () => {
    const routed = routeRole(roles, '@data analyst can you review this table?');
    expect(routed.mode).toBe('explicit');
    expect(routed.role.id).toBe('analyst');
  });

  it('routes implicitly by keyword score', () => {
    const routed = routeRole(roles, 'need conversion funnel metric analysis for signup flow');
    expect(routed.mode).toBe('implicit');
    expect(routed.role.id).toBe('analyst');
  });

  it('ignores disabled roles during routing', () => {
    const routed = routeRole(roles, 'please craft campaign headline copy');
    expect(routed.role.id).not.toBe('writer');
  });

  it('falls back to first enabled role when no signals', () => {
    const routed = routeRole(roles, 'hello team');
    expect(routed.role.id).toBe('manager');
  });
});
