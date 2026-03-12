import { randomUUID } from 'node:crypto';
import type {
  CollaborationProtocol,
  TeamRoleDefinition,
  VirtualTeam,
} from './types';

export type CollaborationInteractionIntent = 'clarify' | 'handoff' | 'review' | 'complete';

export interface RoleCollaborationInteraction {
  id: string;
  step: number;
  protocol: CollaborationProtocol;
  intent: CollaborationInteractionIntent;
  executorRoleId: string;
  fromRoleId: string;
  toRoleId: string;
  title: string;
  expectedOutput: string;
  meta?: Record<string, string>;
}

export interface RoleCollaborationPlan {
  goalId: string;
  protocol: CollaborationProtocol;
  coordinatorRoleId: string;
  roleSequence: string[];
  interactions: RoleCollaborationInteraction[];
}

interface BuildCollaborationPlanInput {
  team: VirtualTeam;
  goalInput: string;
  requestedRoleId?: string;
  protocol?: CollaborationProtocol;
}

function resolveProtocol(team: VirtualTeam, protocol?: CollaborationProtocol): CollaborationProtocol {
  return protocol || team.defaultCollaborationProtocol || 'native';
}

function resolveCoordinator(
  enabledRoles: TeamRoleDefinition[],
  requestedRoleId?: string,
): TeamRoleDefinition {
  if (!requestedRoleId) {
    return enabledRoles[0];
  }

  const matched = enabledRoles.find((role) => role.id === requestedRoleId);
  if (!matched) {
    throw new Error(`Requested role for collaborative execution is unavailable: ${requestedRoleId}`);
  }
  return matched;
}

function buildProtocolMeta(
  protocol: CollaborationProtocol,
  step: number,
  intent: CollaborationInteractionIntent,
): Record<string, string> | undefined {
  if (protocol === 'langgraph') {
    return {
      graphNode: `graph_step_${step}`,
      graphIntent: intent,
    };
  }
  if (protocol === 'crewai') {
    return {
      crewTask: `crew_task_${step}`,
      crewIntent: intent,
    };
  }
  if (protocol === 'n8n') {
    return {
      workflowNode: `n8n_node_${step}`,
      workflowIntent: intent,
    };
  }
  return undefined;
}

function addInteraction(
  interactions: RoleCollaborationInteraction[],
  protocol: CollaborationProtocol,
  intent: CollaborationInteractionIntent,
  executorRoleId: string,
  fromRoleId: string,
  toRoleId: string,
  title: string,
  expectedOutput: string,
): void {
  const step = interactions.length + 1;
  interactions.push({
    id: randomUUID(),
    step,
    protocol,
    intent,
    executorRoleId,
    fromRoleId,
    toRoleId,
    title,
    expectedOutput,
    meta: buildProtocolMeta(protocol, step, intent),
  });
}

export function buildRoleCollaborationPlan(input: BuildCollaborationPlanInput): RoleCollaborationPlan {
  const protocol = resolveProtocol(input.team, input.protocol);
  const enabledRoles = input.team.roles.filter((role) => role.enabled);
  if (enabledRoles.length === 0) {
    throw new Error('No enabled roles available for collaborative execution');
  }

  const coordinator = resolveCoordinator(enabledRoles, input.requestedRoleId);
  const specialists = enabledRoles.filter((role) => role.id !== coordinator.id);
  const interactions: RoleCollaborationInteraction[] = [];

  addInteraction(
    interactions,
    protocol,
    'clarify',
    coordinator.id,
    coordinator.id,
    coordinator.id,
    'Clarify goal and constraints',
    'Goal decomposition, success criteria, and specialist handoff checklist.',
  );

  for (const specialist of specialists) {
    addInteraction(
      interactions,
      protocol,
      'handoff',
      specialist.id,
      coordinator.id,
      specialist.id,
      `Specialist execution for ${specialist.name}`,
      `Role deliverable from ${specialist.name} with assumptions and risks.`,
    );

    if (protocol !== 'native') {
      addInteraction(
        interactions,
        protocol,
        'review',
        coordinator.id,
        specialist.id,
        coordinator.id,
        `Review specialist output from ${specialist.name}`,
        'Consolidated review note with accept/rework decision.',
      );
    }
  }

  addInteraction(
    interactions,
    protocol,
    'complete',
    coordinator.id,
    coordinator.id,
    coordinator.id,
    'Finalize collaborative result',
    'Final response with recommendation, rationale, and next actions.',
  );

  const roleSequence = interactions.map((item) => item.executorRoleId);

  return {
    goalId: randomUUID(),
    protocol,
    coordinatorRoleId: coordinator.id,
    roleSequence,
    interactions,
  };
}
