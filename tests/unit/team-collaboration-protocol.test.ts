import { describe, expect, it } from 'vitest';
import { buildRoleCollaborationPlan } from '@electron/team/collaboration-protocol';
import type { VirtualTeam } from '@electron/team/types';

function buildTeam(): VirtualTeam {
  return {
    id: 'flight-team',
    name: 'Flight Team',
    domain: 'travel',
    description: 'flight team',
    defaultCollaborationProtocol: 'native',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
    roles: [
      {
        id: 'trip-coordinator',
        name: 'Trip Coordinator',
        personality: 'Goal-first',
        responsibilities: ['Coordinate tasks'],
        boundaries: ['No payment'],
        keywords: ['trip'],
        skills: ['flight.goal.parse'],
        enabled: true,
      },
      {
        id: 'inventory-scout',
        name: 'Inventory Scout',
        personality: 'Fast',
        responsibilities: ['Collect candidate flights'],
        boundaries: ['No hidden assumptions'],
        keywords: ['flight'],
        skills: ['flight.search'],
        enabled: true,
      },
      {
        id: 'price-analyst',
        name: 'Price Analyst',
        personality: 'Numerical',
        responsibilities: ['Compare prices'],
        boundaries: ['No unsupported estimate'],
        keywords: ['price'],
        skills: ['flight.compare'],
        enabled: true,
      },
    ],
    feishu: {
      enabled: false,
      appId: '',
      appSecret: '',
      verificationToken: '',
      encryptKey: '',
      botName: 'AI Virtual Team',
    },
  };
}

describe('team collaboration protocol planner', () => {
  it('builds native protocol interaction plan with minimal review steps', () => {
    const plan = buildRoleCollaborationPlan({
      team: buildTeam(),
      goalInput: 'Find and book a flight',
      requestedRoleId: 'trip-coordinator',
    });

    expect(plan.protocol).toBe('native');
    expect(plan.interactions.map((item) => item.intent)).toEqual([
      'clarify',
      'handoff',
      'handoff',
      'complete',
    ]);
  });

  it('builds non-native adapters with explicit review interactions', () => {
    const plan = buildRoleCollaborationPlan({
      team: buildTeam(),
      goalInput: 'Find and compare flights',
      requestedRoleId: 'trip-coordinator',
      protocol: 'langgraph',
    });

    expect(plan.interactions).toHaveLength(6);
    expect(plan.interactions.filter((item) => item.intent === 'review')).toHaveLength(2);
    expect(plan.interactions.every((item) => item.meta?.graphNode)).toBe(true);
  });

  it('falls back to the team default protocol when the task does not override it', () => {
    const plan = buildRoleCollaborationPlan({
      team: {
        ...buildTeam(),
        defaultCollaborationProtocol: 'crewai',
      },
      goalInput: 'Find and compare flights',
      requestedRoleId: 'trip-coordinator',
    });

    expect(plan.protocol).toBe('crewai');
    expect(plan.interactions.filter((item) => item.intent === 'review')).toHaveLength(2);
  });

  it('throws for unavailable requested coordinator role', () => {
    expect(() => buildRoleCollaborationPlan({
      team: buildTeam(),
      goalInput: 'Book flight',
      requestedRoleId: 'unknown-role',
      protocol: 'n8n',
    })).toThrow('Requested role for collaborative execution is unavailable');
  });
});
