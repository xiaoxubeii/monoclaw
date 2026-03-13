import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import type { RoleRuntimeSnapshot, RoleRuntimeStatus, TeamRoleDefinition } from './types';

interface StartRoleInput {
  teamId: string;
  role: TeamRoleDefinition;
  soulPath: string;
  agentBinding?: RoleRuntimeAgentBinding | null;
}

export interface RoleRuntimeAgentBinding {
  providerId: string;
  providerType: string;
  providerLabel: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

interface RuntimeRecord {
  key: string;
  teamId: string;
  roleId: string;
  roleName: string;
  soulPath: string;
  process: ChildProcess;
  status: RoleRuntimeStatus;
  startedAt?: string;
  lastHeartbeatAt?: string;
  currentTaskId?: string;
  lastError?: string;
  stopping?: boolean;
}

interface RuntimeMessage {
  type?: string;
  taskId?: string;
  output?: string;
  error?: string;
  ts?: number;
  busy?: boolean;
  currentTaskId?: string | null;
  provider?: string;
  model?: string;
  executionMode?: 'provider' | 'mock';
}

export interface RuntimeTaskResult {
  teamId: string;
  roleId: string;
  taskId: string;
  output: string;
}

export interface RuntimeTaskError {
  teamId: string;
  roleId: string;
  taskId: string;
  error: string;
}

// Lightweight role runtime script executed in a dedicated Node process.
// It keeps role isolation while avoiding direct renderer access.
const WORKER_BOOTSTRAP_SCRIPT = [
  "const fs = require('node:fs/promises');",
  "const teamId = process.env.MONOCLAW_TEAM_ID || 'unknown-team';",
  "const roleId = process.env.MONOCLAW_ROLE_ID || 'unknown-role';",
  "const roleName = process.env.MONOCLAW_ROLE_NAME || roleId;",
  "const soulPath = process.env.MONOCLAW_SOUL_PATH || '';",
  "const roleSkills = String(process.env.MONOCLAW_ROLE_SKILLS || '').split(',').map((item) => item.trim()).filter(Boolean);",
  "const agentProviderLabel = process.env.MONOCLAW_AGENT_PROVIDER_LABEL || '';",
  "const agentModel = process.env.MONOCLAW_AGENT_MODEL || '';",
  "const agentBaseUrl = String(process.env.MONOCLAW_AGENT_BASE_URL || '').replace(/\\/+$/, '');",
  "const agentApiKey = process.env.MONOCLAW_AGENT_API_KEY || '';",
  "const agentSystemPrompt = (() => { try { return Buffer.from(process.env.MONOCLAW_AGENT_SYSTEM_PROMPT_B64 || '', 'base64').toString('utf8'); } catch { return ''; } })();",
  "const agentTemperature = Number.parseFloat(process.env.MONOCLAW_AGENT_TEMPERATURE || '0.2') || 0.2;",
  "const agentMaxTokens = Math.max(64, Number.parseInt(process.env.MONOCLAW_AGENT_MAX_TOKENS || '2048', 10) || 2048);",
  "const providerRequestTimeoutMs = Math.max(30000, Number.parseInt(process.env.MONOCLAW_PROVIDER_REQUEST_TIMEOUT_MS || '120000', 10) || 120000);",
  "const providerRequestRetries = Math.max(0, Number.parseInt(process.env.MONOCLAW_PROVIDER_REQUEST_RETRIES || '1', 10) || 1);",
  "const providerRequestRetryBackoffMs = Math.max(250, Number.parseInt(process.env.MONOCLAW_PROVIDER_REQUEST_RETRY_BACKOFF_MS || '1200', 10) || 1200);",
  "const executionMode = agentBaseUrl && agentApiKey && agentModel ? 'provider' : 'mock';",
  "const runtimeLatencyFloorMs = Math.max(50, Number.parseInt(process.env.MONOCLAW_ROLE_RUNTIME_LATENCY_FLOOR_MS || '900', 10) || 900);",
  "const runtimeLatencyCapMs = Math.max(runtimeLatencyFloorMs, Number.parseInt(process.env.MONOCLAW_ROLE_RUNTIME_LATENCY_CAP_MS || '4500', 10) || 4500);",
  'let busy = false;',
  'let currentTaskId = null;',
  "let cachedSoul = '';",
  'function send(payload) {',
  "  if (typeof process.send === 'function') {",
  '    process.send(payload);',
  '  }',
  '}',
  'async function readSoul() {',
  "  if (!soulPath) return '';",
  '  if (cachedSoul) return cachedSoul;',
  '  try {',
  "    cachedSoul = await fs.readFile(soulPath, 'utf-8');",
  '    return cachedSoul;',
  '  } catch {',
  "    return '';",
  '  }',
  '}',
  'function summarizePersona(rawSoul) {',
  "  if (!rawSoul) return 'No SOUL profile loaded.';",
  "  const compact = rawSoul.replace(/\\s+/g, ' ').trim();",
  '  if (!compact) return "No SOUL profile loaded.";',
  "  return compact.slice(0, 220) + (compact.length > 220 ? '...' : '');",
  '}',
  'function extractTextContent(content) {',
  "  if (typeof content === 'string') return content.trim();",
  '  if (!Array.isArray(content)) return "";',
  '  return content.map((item) => {',
  "    if (typeof item === 'string') return item;",
  "    if (item && typeof item.text === 'string') return item.text;",
  "    if (item && item.type === 'text' && typeof item.text === 'string') return item.text;",
  '    return "";',
  "  }).join('\\n').trim();",
  '}',
  'function extractAssistantText(payload) {',
  "  if (payload && typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();",
  '  const choice = Array.isArray(payload && payload.choices) ? payload.choices[0] : null;',
  "  if (choice && choice.message) return extractTextContent(choice.message.content || choice.message);",
  '  return "";',
  '}',
  'function isRetriableProviderFailure(error, statusCode) {',
  "  if (typeof statusCode === 'number' && (statusCode === 429 || statusCode >= 500)) return true;",
  "  const message = String(error || '').toLowerCase();",
  "  return message.includes('aborterror') || message.includes('timed out') || message.includes('timeout') || message.includes('fetch failed') || message.includes('networkerror') || message.includes('econnreset') || message.includes('socket hang up');",
  '}',
  'async function sleep(ms) {',
  '  await new Promise((resolve) => setTimeout(resolve, ms));',
  '}',
  'async function runBoundModel(taskInput, personaSummary) {',
  "  if (executionMode !== 'provider') return null;",
  '  const systemSections = [',
  "    agentSystemPrompt || `You are ${roleName}.`,",
  '    `SOUL Summary: ${personaSummary}`,',
  "    `Role skills: ${roleSkills.join(', ') || 'none'}`,",
  "    'Response contract: keep answers concise, prefer bullets, avoid markdown tables, use at most 5 bullets, stay under 140 words unless the task strictly requires more, and reply in the same language as the user task input.'",
  "  ].filter(Boolean).join('\\n\\n');",
  '  let lastError = null;',
  '  const maxAttempts = providerRequestRetries + 1;',
  '  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {',
  '    const controller = new AbortController();',
  '    const timeout = setTimeout(() => controller.abort(), providerRequestTimeoutMs);',
  '    let response;',
  '    let statusCode;',
  '    try {',
  '      response = await fetch(`${agentBaseUrl}/chat/completions`, {',
  "        method: 'POST',",
  "        headers: { Authorization: `Bearer ${agentApiKey}`, 'Content-Type': 'application/json' },",
  '        signal: controller.signal,',
  '        body: JSON.stringify({',
  '          model: agentModel,',
  '          messages: [',
  "            { role: 'system', content: systemSections },",
  "            { role: 'user', content: taskInput },",
  '          ],',
  '          temperature: agentTemperature,',
  '          max_tokens: agentMaxTokens,',
  '          stream: false,',
  '        }),',
  '      });',
  '      statusCode = response.status;',
  '      const data = await response.json().catch(() => ({}));',
  '      if (!response.ok) {',
  "        const msg = (data && data.error && data.error.message) || data.message || `Provider error: ${response.status}`;",
  '        throw new Error(String(msg));',
  '      }',
  '      const text = extractAssistantText(data);',
  "      if (!text) throw new Error('Provider returned empty output');",
  '      return text;',
  '    } catch (error) {',
  '      lastError = error;',
  '      const shouldRetry = attempt < maxAttempts && isRetriableProviderFailure(error, statusCode);',
  '      if (!shouldRetry) {',
  '        throw error;',
  '      }',
  "      console.warn(`[provider] request failed attempt ${attempt}/${maxAttempts} for ${roleId}: ${String(error)}`);",
  '      await sleep(providerRequestRetryBackoffMs * attempt);',
  '    } finally {',
  '      clearTimeout(timeout);',
  '    }',
  '  }',
  '  throw lastError || new Error("Provider request failed");',
  '}',
  'function detectResponseLanguage(taskInput) {',
  "  const text = String(taskInput || '');",
  "  if (/[\\u3040-\\u30ff]/.test(text)) return 'ja';",
  "  if (/[\\u4e00-\\u9fff]/.test(text)) return 'zh';",
  "  return 'en';",
  '}',
  'function buildFlightDeliverable(taskInput) {',
  "  const raw = String(taskInput || '');",
  "  const text = raw.toLowerCase();",
  '  const responseLanguage = detectResponseLanguage(raw);',
  "  const flightContext = /(flight|flights|ticket|airline|航班|机票|预订|比价)/.test(text);",
  '  if (!flightContext) return null;',
  '',
  "  const hasCoordinatorSkill = roleSkills.some((item) => item.includes('flight.goal') || item.includes('flight.workflow') || item.includes('flight.result'));",
  "  const hasSearchSkill = roleSkills.some((item) => item.includes('flight.search') || item.includes('flight.query'));",
  "  const hasCompareSkill = roleSkills.some((item) => item.includes('flight.compare') || item.includes('flight.pricing'));",
  "  const hasPolicySkill = roleSkills.some((item) => item.includes('flight.policy') || item.includes('flight.invoice'));",
  "  const hasBookingSkill = roleSkills.some((item) => item.includes('flight.book') || item.includes('flight.booking'));",
  '',
  "  if (hasCoordinatorSkill && (/(booking readiness packet|selected flight|payment confirmation|policy validation note)/.test(text) || /intent:\\s*complete/.test(text) || /expected output:.*recommendation/.test(text))) {",
  "    if (responseLanguage === 'zh') {",
  "      return [",
  "        '机票预订最终建议：',",
  "        '- 推荐方案：候选 A / MU5101（含可退改保护）。',",
  "        '- 推荐理由：在时刻稳定性、退改灵活性与总成本之间更均衡。',",
  "        '- 政策状态：乘机人信息、发票抬头与审批人确认后可判定为合规。',",
  "        '- 预订状态：可进入预订，仍需人工明确确认后才能支付。',",
  "        '- 下一步：发送预订确认包给出行人或操作人进行最终确认。'",
  "      ].join('\\\\n');",
  '    }',
  "    return [",
  "      'Flight Booking Final Recommendation:',",
  "      '- Recommended option: Candidate A / MU5101 with refundable fare protection.',",
  "      '- Why: best tradeoff across schedule reliability, refund flexibility, and total trip cost.',",
  "      '- Policy status: compliant if traveler profile, invoice title, and approver are confirmed.',",
  "      '- Booking state: ready for reservation, still blocked on explicit human payment confirmation.',",
  "      '- Next step: send booking packet to the traveler or operator for approval and payment.'",
  "    ].join('\\\\n');",
  '  }',
  '',
  "  if (hasCoordinatorSkill) {",
  "    if (responseLanguage === 'zh') {",
  "      return [",
  "        '机票目标简报：',",
  "        '- 目标：收集候选航班、比较退改规则、完成政策校验并形成预订包。',",
  "        '- 约束：明确取舍，不做隐含假设，并在支付前停下等待人工确认。',",
  "        '- 角色接力：库存搜索 -> 价格分析 -> 政策校验 -> 预订执行。'",
  "      ].join('\\\\n');",
  '    }',
  "    return [",
  "      'Flight Goal Brief:',",
  "      '- Mission: collect candidate flights, compare fare rules, validate policy, and prepare a booking packet.',",
  "      '- Constraints: keep tradeoffs explicit, avoid hidden assumptions, and stop before payment submission.',",
  "      '- Specialist routing: inventory scout -> price analyst -> policy checker -> booking operator.'",
  "    ].join('\\\\n');",
  '  }',
  '',
  "  if (hasSearchSkill) {",
  "    if (responseLanguage === 'zh') {",
  "      return [",
  "        '航班搜索草案：',",
  "        '- 候选 A：MU5101 SHA->PEK 09:10-11:25，票价 CNY 1120，可退改（收手续费）',",
  "        '- 候选 B：CA1854 SHA->PEK 10:20-12:30，票价 CNY 980，仅手提行李',",
  "        '- 候选 C：HO1259 SHA->PEK 13:00-15:15，票价 CNY 860，不可退',",
  "        '- 下一步：将候选结果交给价格分析与政策校验角色。'",
  "      ].join('\\\\n');",
  '    }',
  "    return [",
  "      'Flight Search Draft:',",
  "      '- Candidate A: MU5101 SHA->PEK 09:10-11:25, fare CNY 1120, refundable with fee',",
  "      '- Candidate B: CA1854 SHA->PEK 10:20-12:30, fare CNY 980, carry-on only',",
  "      '- Candidate C: HO1259 SHA->PEK 13:00-15:15, fare CNY 860, non-refundable',",
  "      '- Next step: send candidates to price analyst and policy checker.'",
  "    ].join('\\\\n');",
  '  }',
  '',
  "  if (hasCompareSkill) {",
  "    if (responseLanguage === 'zh') {",
  "      return [",
  "        '机票价格对比：',",
  "        '- 评分维度：总成本、衔接风险、退改灵活性、到达时效',",
  "        '- 排名 #1 候选 A（灵活性与成本更均衡）',",
  "        '- 排名 #2 候选 B（票价更低，但行李风险更高）',",
  "        '- 排名 #3 候选 C（最低价，但不可退）',",
  "        '- 下一步：将推荐方案与备选方案交给预订执行角色。'",
  "      ].join('\\\\n');",
  '    }',
  "    return [",
  "      'Flight Pricing Comparison:',",
  "      '- Scoring dimensions: total cost, transfer risk, refund flexibility, arrival SLA',",
  "      '- Rank #1 Candidate A (balanced flexibility/cost)',",
  "      '- Rank #2 Candidate B (lower fare, baggage risk)',",
  "      '- Rank #3 Candidate C (lowest fare, non-refundable)',",
  "      '- Next step: hand off recommended option + fallback to booking operator.'",
  "    ].join('\\\\n');",
  '  }',
  '',
  "  if (hasPolicySkill) {",
  "    if (responseLanguage === 'zh') {",
  "      return [",
  "        '机票政策校验说明：',",
  "        '- 乘机人资料必填：法定姓名、证件号、手机号、发票主体。',",
  "        '- 政策结论：候选 A 可接受，原因是退改条件已明确。',",
  "        '- 运行风险：仅手提行李票价如无豁免应判定不通过。',",
  "        '- 审批关口：审批人与支付人身份确认前不得进入支付。'",
  "      ].join('\\\\n');",
  '    }',
  "    return [",
  "      'Flight Policy Validation Note:',",
  "      '- Traveler profile required: legal name, government ID, mobile number, and invoice entity.',",
  "      '- Policy check: Candidate A is acceptable because refund/change conditions are documented.',",
  "      '- Operational risk: carry-on-only fares should be rejected unless baggage waiver is approved.',",
  "      '- Approval gate: do not proceed to payment until approver and payer identity are confirmed.'",
  "    ].join('\\\\n');",
  '  }',
  '',
  "  if (hasBookingSkill) {",
  "    if (responseLanguage === 'zh') {",
  "      return [",
  "        '预订就绪确认包：',",
  "        '- 已选航班：候选 A（MU5101）',",
  "        '- 必填字段：乘机人姓名/证件、联系方式、发票抬头、支付人',",
  "        '- 预订前检查：政策审批、锁价窗口、退改条款',",
  "        '- 动作：可发起预订申请，等待人工明确支付确认。'",
  "      ].join('\\\\n');",
  '    }',
  "    return [",
  "      'Booking Readiness Packet:',",
  "      '- Selected flight: Candidate A (MU5101)',",
  "      '- Required fields: passenger name/ID, contact, invoice title, payment owner',",
  "      '- Pre-book checks: policy approval, fare lock window, cancellation conditions',",
  "      '- Action: booking request ready, waiting for explicit human payment confirmation.'",
  "    ].join('\\\\n');",
  '  }',
  '',
  '  return null;',
  '}',
  'function buildOutput(taskInput, personaSummary) {',
  "  const taskSnippet = taskInput.slice(0, 640) + (taskInput.length > 640 ? '...' : '');",
  '  const flightDeliverable = buildFlightDeliverable(taskInput);',
  '  const responseLanguage = detectResponseLanguage(taskInput);',
  "  if (responseLanguage === 'zh') {",
  "    return [",
  "      `角色: ${roleName} (${roleId})`,",
  "      `团队: ${teamId}`,",
  "      `执行模式: ${executionMode}${agentModel ? ` (${agentProviderLabel || 'provider'} / ${agentModel})` : ''}`,",
  "      `技能: ${roleSkills.join(', ') || 'none'}`,",
  "      '工作摘要:',",
  "      `- 请求理解: ${taskSnippet || '(空输入)'}`,",
  "      `- 角色锚点: ${personaSummary}`,",
  "      '- 下一步: 按角色职责完成分析并返回结构化交付物。',",
  "      flightDeliverable ? '' : '- 航班相关交付物: 本任务不适用。',",
  "      flightDeliverable || ''",
  "    ].join('\\\\n');",
  '  }',
  "  return [",
  "    `Role: ${roleName} (${roleId})`,",
  "    `Team: ${teamId}`,",
  "    `Execution Mode: ${executionMode}${agentModel ? ` (${agentProviderLabel || 'provider'} / ${agentModel})` : ''}`,",
  "    `Skills: ${roleSkills.join(', ') || 'none'}`,",
  "    'Work Summary:',",
  "    `- Interpreted request: ${taskSnippet || '(empty input)'}`,",
  "    `- Persona anchor: ${personaSummary}`,",
  "    '- Proposed next action: execute role-specific analysis and return structured deliverables.',",
  "    flightDeliverable ? '' : '- Flight-specific deliverable: not applicable in this task.',",
  "    flightDeliverable || ''",
  "  ].join('\\n');",
  '}',
  'send({ type: "ready", ts: Date.now(), pid: process.pid, provider: agentProviderLabel || undefined, model: agentModel || undefined, executionMode });',
  'const heartbeat = setInterval(() => {',
  '  send({ type: "heartbeat", ts: Date.now(), busy, currentTaskId });',
  '}, 4000);',
  'heartbeat.unref();',
  'process.on("message", async (payload) => {',
  '  if (!payload || typeof payload !== "object") return;',
  '  if (payload.type === "shutdown") {',
  '    send({ type: "shutdown-ack", ts: Date.now() });',
  '    process.exit(0);',
  '    return;',
  '  }',
  '  if (payload.type !== "task") return;',
  '  if (busy) {',
  '    send({ type: "task-error", taskId: String(payload.taskId || ""), error: "role runtime is busy", ts: Date.now() });',
  '    return;',
  '  }',
  '  busy = true;',
  '  currentTaskId = String(payload.taskId || "");',
  '  send({ type: "task-started", taskId: currentTaskId, ts: Date.now() });',
  '  try {',
  '    const personaSummary = summarizePersona(await readSoul());',
  '    const input = typeof payload.input === "string" ? payload.input : "";',
  '    const latencyMs = Math.min(runtimeLatencyCapMs, Math.max(runtimeLatencyFloorMs, input.length * 18));',
  '    await new Promise((resolve) => setTimeout(resolve, latencyMs));',
  '    const output = executionMode === "provider"',
  '      ? await runBoundModel(input, personaSummary)',
  '      : buildOutput(input, personaSummary);',
  '    send({ type: "task-result", taskId: currentTaskId, output, ts: Date.now() });',
  '  } catch (error) {',
  '    send({ type: "task-error", taskId: currentTaskId, error: String(error), ts: Date.now() });',
  '  } finally {',
  '    busy = false;',
  '    currentTaskId = null;',
  '  }',
  '});',
  'process.on("SIGTERM", () => process.exit(0));',
].join('\n');

function runtimeKey(teamId: string, roleId: string): string {
  return `${teamId}:${roleId}`;
}

function toSnapshot(record: RuntimeRecord): RoleRuntimeSnapshot {
  return {
    teamId: record.teamId,
    roleId: record.roleId,
    roleName: record.roleName,
    status: record.status,
    pid: record.process.pid,
    startedAt: record.startedAt,
    lastHeartbeatAt: record.lastHeartbeatAt,
    currentTaskId: record.currentTaskId,
    lastError: record.lastError,
  };
}

export class TeamProcessSupervisor extends EventEmitter {
  private readonly runtimes = new Map<string, RuntimeRecord>();

  private async waitForReady(record: RuntimeRecord, timeoutMs = 5000): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        record.process.removeListener('message', onMessage);
        record.process.removeListener('error', onError);
        record.process.removeListener('exit', onExit);
        fn();
      };

      const onMessage = (raw: unknown) => {
        if (!raw || typeof raw !== 'object') return;
        const message = raw as RuntimeMessage;
        if (message.type === 'ready') {
          finish(resolve);
        }
      };

      const onError = (error: Error) => {
        finish(() => reject(error));
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        finish(() => reject(new Error(
          `Role runtime exited before ready (team=${record.teamId}, role=${record.roleId}, code=${code}, signal=${signal})`,
        )));
      };

      const timeout = setTimeout(() => {
        finish(() => reject(new Error(
          `Role runtime startup timeout after ${timeoutMs}ms (team=${record.teamId}, role=${record.roleId})`,
        )));
      }, timeoutMs);
      timeout.unref();

      record.process.on('message', onMessage);
      record.process.on('error', onError);
      record.process.on('exit', onExit);
    });
  }

  async startRole(input: StartRoleInput): Promise<RoleRuntimeSnapshot> {
    const key = runtimeKey(input.teamId, input.role.id);
    const existing = this.runtimes.get(key);
    if (existing && existing.status !== 'stopped') {
      return toSnapshot(existing);
    }

    const child = spawn(process.execPath, ['-e', WORKER_BOOTSTRAP_SCRIPT], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        // Main process execPath is Electron in dev/packaged mode. Force Node
        // semantics so `-e` runs the worker bootstrap script instead of being
        // interpreted as an Electron app path.
        ELECTRON_RUN_AS_NODE: '1',
        MONOCLAW_TEAM_ID: input.teamId,
        MONOCLAW_ROLE_ID: input.role.id,
        MONOCLAW_ROLE_NAME: input.role.name,
        MONOCLAW_SOUL_PATH: input.soulPath,
        MONOCLAW_ROLE_SKILLS: (input.role.skills ?? []).join(','),
        MONOCLAW_AGENT_PROVIDER_LABEL: input.agentBinding?.providerLabel || '',
        MONOCLAW_AGENT_MODEL: input.agentBinding?.model || '',
        MONOCLAW_AGENT_BASE_URL: input.agentBinding?.baseUrl || '',
        MONOCLAW_AGENT_API_KEY: input.agentBinding?.apiKey || '',
        MONOCLAW_AGENT_SYSTEM_PROMPT_B64: input.agentBinding
          ? Buffer.from(input.agentBinding.systemPrompt, 'utf8').toString('base64')
          : '',
        MONOCLAW_AGENT_TEMPERATURE: input.agentBinding
          ? String(input.agentBinding.temperature)
          : '',
        MONOCLAW_AGENT_MAX_TOKENS: input.agentBinding
          ? String(Math.round(input.agentBinding.maxTokens))
          : '',
      },
      windowsHide: true,
    });

    const record: RuntimeRecord = {
      key,
      teamId: input.teamId,
      roleId: input.role.id,
      roleName: input.role.name,
      soulPath: input.soulPath,
      process: child,
      status: 'starting',
      startedAt: new Date().toISOString(),
    };

    this.runtimes.set(key, record);
    this.emit('runtime-status', toSnapshot(record));

    child.stdout?.on('data', (chunk) => {
      this.emit('runtime-log', {
        teamId: record.teamId,
        roleId: record.roleId,
        level: 'info' as const,
        message: String(chunk).trim(),
      });
    });

    child.stderr?.on('data', (chunk) => {
      const line = String(chunk).trim();
      if (!line) return;
      record.lastError = line;
      this.emit('runtime-log', {
        teamId: record.teamId,
        roleId: record.roleId,
        level: 'warn' as const,
        message: line,
      });
    });

    child.on('message', (raw) => {
      if (!raw || typeof raw !== 'object') return;
      const message = raw as RuntimeMessage;
      this.handleRuntimeMessage(record, message);
    });

    child.on('error', (error) => {
      record.status = 'error';
      record.lastError = String(error);
      this.emit('runtime-status', toSnapshot(record));
      this.emit('runtime-log', {
        teamId: record.teamId,
        roleId: record.roleId,
        level: 'error' as const,
        message: `Role runtime process error: ${String(error)}`,
      });
    });

    child.on('exit', (code, signal) => {
      const wasIntentional = record.stopping === true || record.status === 'stopped' || record.status === 'error';
      record.status = wasIntentional ? 'stopped' : 'error';
      record.stopping = false;
      record.currentTaskId = undefined;
      record.lastHeartbeatAt = new Date().toISOString();
      if (!wasIntentional) {
        record.lastError = `role runtime exited unexpectedly (code=${code}, signal=${signal})`;
      }
      this.emit('runtime-status', toSnapshot(record));
      if (!wasIntentional) {
        this.emit('runtime-log', {
          teamId: record.teamId,
          roleId: record.roleId,
          level: 'error' as const,
          message: record.lastError ?? 'Role runtime exited unexpectedly',
        });
      }
    });

    try {
      await this.waitForReady(record);
      return toSnapshot(record);
    } catch (error) {
      const message = String(error);
      record.status = 'error';
      record.lastError = message;
      this.emit('runtime-status', toSnapshot(record));
      this.emit('runtime-log', {
        teamId: record.teamId,
        roleId: record.roleId,
        level: 'error' as const,
        message,
      });

      if (record.process.exitCode === null && !record.process.killed) {
        try {
          record.process.kill('SIGTERM');
        } catch {
          // noop
        }
      }
      throw new Error(message);
    }
  }

  private handleRuntimeMessage(record: RuntimeRecord, message: RuntimeMessage): void {
    const ts = message.ts ? new Date(message.ts).toISOString() : new Date().toISOString();

    switch (message.type) {
      case 'ready':
        record.status = 'idle';
        record.lastHeartbeatAt = ts;
        this.emit('runtime-status', toSnapshot(record));
        {
          const bindingLabel = message.executionMode === 'provider'
            ? `${message.provider || 'provider'} / ${message.model || 'auto'}`
            : 'mock-runtime';
          this.emit('runtime-log', {
            teamId: record.teamId,
            roleId: record.roleId,
            level: 'info' as const,
            message: `Role runtime ready (pid=${record.process.pid ?? 'unknown'}, binding=${bindingLabel})`,
          });
        }
        return;

      case 'heartbeat':
        record.lastHeartbeatAt = ts;
        if (message.busy === true && record.status !== 'busy') {
          record.status = 'busy';
        }
        if (message.busy === false && record.status === 'busy') {
          record.status = 'idle';
        }
        record.currentTaskId = message.currentTaskId || undefined;
        this.emit('runtime-status', toSnapshot(record));
        return;

      case 'task-started':
        record.status = 'busy';
        record.currentTaskId = message.taskId;
        record.lastHeartbeatAt = ts;
        this.emit('runtime-status', toSnapshot(record));
        return;

      case 'task-result': {
        record.status = 'idle';
        record.currentTaskId = undefined;
        record.lastHeartbeatAt = ts;
        this.emit('runtime-status', toSnapshot(record));
        this.emit('task-result', {
          teamId: record.teamId,
          roleId: record.roleId,
          taskId: message.taskId ?? '',
          output: message.output ?? '',
        } satisfies RuntimeTaskResult);
        return;
      }

      case 'task-error':
        record.status = 'error';
        record.currentTaskId = undefined;
        record.lastError = message.error ?? 'Unknown runtime task error';
        record.lastHeartbeatAt = ts;
        this.emit('runtime-status', toSnapshot(record));
        this.emit('task-error', {
          teamId: record.teamId,
          roleId: record.roleId,
          taskId: message.taskId ?? '',
          error: record.lastError,
        } satisfies RuntimeTaskError);
        this.emit('runtime-log', {
          teamId: record.teamId,
          roleId: record.roleId,
          level: 'error' as const,
          message: record.lastError,
        });
        return;

      default:
        return;
    }
  }

  async dispatchTask(teamId: string, roleId: string, taskId: string, input: string): Promise<void> {
    const key = runtimeKey(teamId, roleId);
    const record = this.runtimes.get(key);
    if (!record || record.status === 'stopped') {
      throw new Error(`Role runtime not started: ${roleId}`);
    }
    if (record.status === 'starting') {
      throw new Error(`Role runtime still starting: ${roleId}`);
    }
    if (record.status === 'busy') {
      throw new Error(`Role runtime is busy: ${roleId}`);
    }
    if (!record.process.connected) {
      throw new Error(`Role runtime IPC channel is disconnected: ${roleId}`);
    }

    record.currentTaskId = taskId;
    record.status = 'busy';
    this.emit('runtime-status', toSnapshot(record));

    record.process.send({
      type: 'task',
      taskId,
      input,
    });
  }

  async stopRole(teamId: string, roleId: string): Promise<void> {
    const key = runtimeKey(teamId, roleId);
    const record = this.runtimes.get(key);
    if (!record) return;

    if (record.process.exitCode !== null || record.process.killed) {
      record.status = 'stopped';
      record.stopping = false;
      this.emit('runtime-status', toSnapshot(record));
      return;
    }

    record.stopping = true;

    await new Promise<void>((resolve) => {
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const forceKill = () => {
        try {
          record.process.kill('SIGTERM');
        } catch {
          // noop
        }

        setTimeout(() => {
          if (record.process.exitCode === null) {
            try {
              record.process.kill('SIGKILL');
            } catch {
              // noop
            }
          }
        }, 1200).unref();
      };

      const timeout = setTimeout(() => {
        forceKill();
        finish();
      }, 3000);

      timeout.unref();

      record.process.once('exit', () => {
        clearTimeout(timeout);
        finish();
      });

      if (record.process.connected) {
        record.process.send({ type: 'shutdown' });
      } else {
        forceKill();
      }
    });

    record.status = 'stopped';
    record.stopping = false;
    record.currentTaskId = undefined;
    this.emit('runtime-status', toSnapshot(record));
  }

  async stopTeam(teamId: string): Promise<void> {
    const targets = [...this.runtimes.values()].filter((runtime) => runtime.teamId === teamId);
    await Promise.all(targets.map((runtime) => this.stopRole(runtime.teamId, runtime.roleId)));
  }

  async stopAll(): Promise<void> {
    const targets = [...this.runtimes.values()];
    await Promise.all(targets.map((runtime) => this.stopRole(runtime.teamId, runtime.roleId)));
  }

  getTeamSnapshots(teamId: string): RoleRuntimeSnapshot[] {
    return [...this.runtimes.values()]
      .filter((runtime) => runtime.teamId === teamId)
      .map((runtime) => toSnapshot(runtime));
  }

  getAllSnapshots(): RoleRuntimeSnapshot[] {
    return [...this.runtimes.values()].map((runtime) => toSnapshot(runtime));
  }
}
