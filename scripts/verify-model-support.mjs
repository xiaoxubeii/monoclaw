#!/usr/bin/env node

/**
 * Verify whether an OpenAI-compatible model is actually available for the current key/base URL.
 *
 * Usage examples:
 * 1) Explicit values:
 *    node scripts/verify-model-support.mjs \
 *      --base-url https://coding.dashscope.aliyuncs.com/v1 \
 *      --api-key "$DASHSCOPE_API_KEY" \
 *      --model qwen3.5-plus
 *
 * 2) Read from OpenClaw models.json provider entry:
 *    node scripts/verify-model-support.mjs \
 *      --models-json /home/cheng/monoclaw_data/00_control/engines/openclaw/state/agents/main/agent/models.json \
 *      --provider custom-customcb
 */

import { readFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

function parseArgs(input) {
  const out = {};
  for (let i = 0; i < input.length; i += 1) {
    const token = input[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = input[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = 'true';
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function sanitizeApiKey(raw) {
  return String(raw || '').replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, '').trim();
}

function sanitizeBaseUrl(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, '')
    .replace(/%00/gi, '')
    .trim()
    .replace(/\/+$/, '');
}

function sanitizeModelId(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, '')
    .replace(/%00/gi, '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

function maskSecret(secret) {
  const text = String(secret || '');
  if (!text) return '(empty)';
  if (text.length <= 8) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function encodeVisible(text) {
  return JSON.stringify(String(text || ''));
}

function providerFromModelsJson(rawJson, providerId) {
  const parsed = JSON.parse(rawJson);
  const providers = parsed?.providers;
  if (!providers || typeof providers !== 'object') {
    throw new Error('Invalid models.json: missing providers object');
  }
  const provider = providers[providerId];
  if (!provider || typeof provider !== 'object') {
    throw new Error(`Provider "${providerId}" not found in models.json`);
  }
  const model = Array.isArray(provider.models) && provider.models[0] && typeof provider.models[0].id === 'string'
    ? provider.models[0].id
    : '';
  return {
    baseUrl: provider.baseUrl || '',
    apiKey: provider.apiKey || '',
    model,
  };
}

async function callJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

function extractError(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.error === 'string') return data.error;
  if (data.error && typeof data.error.message === 'string') return data.error.message;
  if (typeof data.message === 'string') return data.message;
  return '';
}

async function probeChat(baseUrl, apiKey, model) {
  return await callJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
      temperature: 0,
    }),
  });
}

async function main() {
  const args = parseArgs(argv.slice(2));

  let baseUrl = args['base-url'] || process.env.DASHSCOPE_BASE_URL || process.env.OPENAI_BASE_URL || '';
  let apiKey = args['api-key'] || process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || '';
  let model = args.model || process.env.MODEL || '';

  if (args['models-json'] && args.provider) {
    const raw = await readFile(args['models-json'], 'utf-8');
    const provider = providerFromModelsJson(raw, args.provider);
    baseUrl = provider.baseUrl;
    apiKey = provider.apiKey;
    model = provider.model;
  }

  const normalizedBaseUrl = sanitizeBaseUrl(baseUrl);
  const normalizedApiKey = sanitizeApiKey(apiKey);
  const normalizedModel = sanitizeModelId(model);

  if (!normalizedBaseUrl || !normalizedApiKey || !model) {
    console.error('Missing required input.');
    console.error('Required: baseUrl + apiKey + model, or --models-json + --provider');
    exit(1);
  }

  console.log('== Verify Model Support ==');
  console.log(`baseUrl: ${normalizedBaseUrl}`);
  console.log(`apiKey: ${maskSecret(normalizedApiKey)}`);
  console.log(`model(raw): ${encodeVisible(model)}`);
  console.log(`model(sanitized): ${encodeVisible(normalizedModel)}`);

  const modelsResp = await callJson(`${normalizedBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${normalizedApiKey}` },
  });
  const modelList = Array.isArray(modelsResp.data?.data) ? modelsResp.data.data : [];
  const listed = modelList.some((entry) => entry && String(entry.id) === normalizedModel);
  console.log(`GET /models -> HTTP ${modelsResp.status}, listed=${listed}, count=${modelList.length}`);
  if (!modelsResp.ok) {
    const msg = extractError(modelsResp.data);
    if (msg) console.log(`GET /models error: ${msg}`);
  }

  const rawProbe = await probeChat(normalizedBaseUrl, normalizedApiKey, model);
  console.log(`POST /chat/completions (raw model) -> HTTP ${rawProbe.status}`);
  const rawMsg = extractError(rawProbe.data);
  if (rawMsg) console.log(`raw probe message: ${rawMsg}`);

  let finalProbe = rawProbe;
  if (normalizedModel !== model) {
    const sanitizedProbe = await probeChat(normalizedBaseUrl, normalizedApiKey, normalizedModel);
    finalProbe = sanitizedProbe;
    console.log(`POST /chat/completions (sanitized model) -> HTTP ${sanitizedProbe.status}`);
    const sanitizedMsg = extractError(sanitizedProbe.data);
    if (sanitizedMsg) console.log(`sanitized probe message: ${sanitizedMsg}`);
  }

  if (finalProbe.ok) {
    console.log('RESULT: supported for this key + endpoint');
    exit(0);
  }

  const finalMsg = extractError(finalProbe.data) || `HTTP ${finalProbe.status}`;
  if (/model/i.test(finalMsg) && /(not supported|invalid|unknown|not found|does not exist|unsupported)/i.test(finalMsg)) {
    console.log('RESULT: key is reachable, but model is not available for this endpoint/account');
    exit(2);
  }

  console.log('RESULT: request failed (see message above)');
  exit(1);
}

main().catch((error) => {
  console.error(`verify-model-support failed: ${error instanceof Error ? error.message : String(error)}`);
  exit(1);
});

