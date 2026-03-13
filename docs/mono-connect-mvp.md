# Mono Connect MVP

This worktree isolates a DID-first connectivity MVP inside the existing Monoclaw repository.

## Constraints

- Open-source-only dependencies
- Single repository, multiple modules
- DID and trust are transport-agnostic
- Tailnet transport is a temporary substrate, not the identity layer

## Module layout

- `packages/mono-types`: protocol and persistence types
- `packages/mono-identity`: `did:peer:2` creation, resolution, signing, verification
- `packages/mono-handshake`: challenge-response payloads and verification helpers
- `packages/mono-protocol`: transport protocol constants and JSONL framing helpers
- `electron/mono`: local key store, trust store, tailnet adapter, tailnet transport, peer service
- `src/pages/MonoConnect`: minimal control-plane UI for the MVP

## Open-source boundary

The MVP depends only on:

- Node.js standard library
- the existing Monoclaw open-source stack
- a locally installed `tailscale` client when running against a Headscale-managed tailnet

No closed SaaS control plane is required. The intended deployment target is self-hosted Headscale plus open-source `tailscale` clients.
