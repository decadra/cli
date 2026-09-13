import { z } from 'zod';

const stat = z.strictObject({ median: z.number(), p90: z.number() });

export const sessionsSectionSchema = z.strictObject({
  source: z.enum(['native', 'none']),
  window: z.strictObject({ since: z.string(), until: z.string() }),
  readerVersion: z.string().nullable(),
  observedVersions: z.array(z.string()),
  filesRead: z.number(),
  summary: z
    .strictObject({
      sessions: z.number(),
      turns: stat,
      wallMinutes: stat,
      activeMinutes: stat,
      toolCalls: stat,
      commitCommandShare: z.number(),
      commitWindowShare: z.number().nullable(),
      coAuthorShare: z.number().nullable(),
      repoSessions: z.number(),
      cwdUnknownOrMissing: z.number(),
      coarseDurations: z.number(),
      effortMix: z.array(z.strictObject({ effort: z.string(), sessions: z.number() })),
      effortUnrecorded: z.number(),
      contextPeak: stat.nullable(),
      contextPerReply: stat.nullable(),
      cacheWriteTtl: z.strictObject({ oneHour: z.number(), fiveMinutes: z.number() }).nullable(),
      contextSessions: z.number(),
    })
    .nullable(),
  commitWindowMinutes: z.number(),
  idleGapMinutes: z.number(),
  sessions: z.array(
    z.strictObject({
      sessionId: z.string(),
      cwd: z.string().nullable(),
      firstTs: z.string(),
      lastTs: z.string(),
      wallMinutes: z.number(),
      activeMinutes: z.number(),
      humanTurns: z.number(),
      assistantMessages: z.number(),
      toolCalls: z.number(),
      commitCommandsInTranscript: z.number(),
      commitsInWindow: z.number().nullable(),
      coAuthorTrailers: z.number().nullable(),
      repo: z.enum(['ok', 'missing', 'not-a-repo', 'error', 'unknown-cwd']),
      models: z.array(z.string()),
      efforts: z.array(z.string()),
      contextPeakTokens: z.number().nullable(),
      contextFloorTokens: z.number().nullable(),
      contextWindowTokens: z.number().nullable(),
      cacheWrite1hTokens: z.number().nullable(),
      cacheWrite5mTokens: z.number().nullable(),
      durationQuality: z.enum(['exact', 'coarse']),
    }),
  ),
  error: z.string().nullable(),
});

export type SessionsSection = z.infer<typeof sessionsSectionSchema>;
