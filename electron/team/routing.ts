import type { TeamRoleDefinition } from './types';

function normalizeInput(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsAny(haystack: string, values: string[]): number {
  let hits = 0;
  for (const value of values) {
    const normalized = normalizeInput(value);
    if (!normalized) continue;
    if (haystack.includes(normalized)) {
      hits++;
    }
  }
  return hits;
}

function sanitizeId(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export interface RoutedRoleResult {
  role: TeamRoleDefinition;
  mode: 'explicit' | 'implicit';
  requestedRoleId?: string;
}

export function routeRole(roles: TeamRoleDefinition[], input: string, requestedRoleId?: string): RoutedRoleResult {
  const enabledRoles = roles.filter((role) => role.enabled);
  if (enabledRoles.length === 0) {
    throw new Error('No enabled roles available in team');
  }

  if (requestedRoleId) {
    const explicitByRequest = enabledRoles.find((role) => role.id === sanitizeId(requestedRoleId));
    if (explicitByRequest) {
      return { role: explicitByRequest, mode: 'explicit', requestedRoleId: explicitByRequest.id };
    }
  }

  const normalizedInput = normalizeInput(input);

  for (const role of enabledRoles) {
    const mentionNames = [role.id, role.name].map((item) => normalizeInput(item));
    if (mentionNames.some((name) => name && normalizedInput.includes(`@${name}`))) {
      return { role, mode: 'explicit', requestedRoleId: role.id };
    }
  }

  let bestRole = enabledRoles[0];
  let bestScore = -1;

  for (const role of enabledRoles) {
    let score = 0;
    score += containsAny(normalizedInput, role.keywords) * 5;
    score += containsAny(normalizedInput, role.responsibilities) * 2;
    score += containsAny(normalizedInput, [role.name, role.id]) * 3;

    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }

  return { role: bestRole, mode: 'implicit' };
}
