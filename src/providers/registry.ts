import { homedir } from 'node:os';
import type { PlansFile } from '../config/plans';
import { claudeCode } from './anthropic-claude-code/adapter';
import { codex } from './openai-codex/adapter';
import { cursor } from './cursor/adapter';
import { devin } from './devin/adapter';
import { muse } from './meta-muse/adapter';
import { check, type DoctorEnv, type ProviderAdapter } from './types';

export const builtinAdapters: readonly ProviderAdapter[] = [claudeCode, codex, cursor, devin, muse];

export function defaultDoctorEnv(): DoctorEnv {
  return { home: homedir(), platform: process.platform, env: process.env };
}

/**
 * Built-in adapters first. Any provider declared in plans.json that has no
 * built-in adapter becomes a config-declared adapter: ccusage-backed when it
 * names a ccusage source, otherwise manual. Config never overrides a built-in.
 */
export function resolveAdapters(plans: PlansFile | null): ProviderAdapter[] {
  const byId = new Map<string, ProviderAdapter>();
  for (const a of builtinAdapters) byId.set(a.id, a);
  if (plans) {
    for (const [id, p] of Object.entries(plans.providers)) {
      if (byId.has(id)) continue;
      const usage = p.ingest ?? { kind: 'manual' as const };
      byId.set(id, {
        id,
        displayName: p.displayName,
        meter: p.meter,
        usage,
        async doctor() {
          return [
            usage.kind === 'ccusage'
              ? check(id, `${id}.config`, 'ok', `declared in plans.json, usage via ccusage ${usage.source}`)
              : check(id, `${id}.config`, 'ok', `declared in plans.json, usage entered manually`),
          ];
        },
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Which providers the reporting commands should cover.
 *
 * `'auto'` means the ones you pay for and the ones you demonstrably use: a baseline record
 * names it, or it has usage data on disk. Installation is deliberately not enough. A Devin CLI
 * that was opened once leaves a `sessions.db` behind forever, and Cursor's doctor carries a
 * permanent `warn` about an export that is not built yet, so "the doctor said something other
 * than absent" would show both on a machine that has never used either.
 *
 * `localDataStart` is the signal because it already means exactly this: the earliest date with
 * usage data on disk, or null. An adapter that cannot answer has no reader behind it, and so
 * has nothing to report either way.
 *
 * `doctor` does not call this. Surveying the machine is its job, and hiding half the machine
 * from the command whose purpose is to describe it would be perverse.
 */
export async function visibleProviders(
  adapters: readonly ProviderAdapter[],
  show: 'auto' | readonly string[],
  baselined: ReadonlySet<string>,
  env: DoctorEnv,
): Promise<Set<string>> {
  if (show !== 'auto') return new Set(show);
  const ids = new Set<string>();
  for (const a of adapters) if (baselined.has(a.id)) ids.add(a.id);
  await Promise.all(
    adapters.map(async (a) => {
      if (ids.has(a.id) || !a.localDataStart) return;
      try {
        if (await a.localDataStart(env)) ids.add(a.id);
      } catch {
        // A probe that throws is not a reason to show a provider. doctor reports the fault.
      }
    }),
  );
  return ids;
}

/**
 * Why a provider was left out. Two reasons, and they are not interchangeable: a provider with
 * plenty of usage data on disk is hidden by an explicit list, and saying it had none would be
 * false. `decadra setup` writes a list, so that is the common case, not the rare one.
 */
export function hiddenReason(show: 'auto' | readonly string[]): string {
  return show === 'auto' ? 'no baseline and no local usage data' : 'not listed in providers.show';
}

/** The one sentence printed when something was left out, so a gap is never silent. */
export function hiddenNote(hidden: readonly ProviderAdapter[], show: 'auto' | readonly string[]): string {
  return `not covered (${hiddenReason(show)}): ${hidden.map((a) => a.id).join(', ')}. See all with: decadra doctor, or change with: decadra setup`;
}
