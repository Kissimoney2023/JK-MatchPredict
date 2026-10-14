import {prefetchHandler} from '../server/handler.mjs';

// Vercel Function at /api/prefetch: warms fixtures, standings and team histories.
// Called by Vercel Cron (see vercel.json) and optionally by a GitHub Actions schedule.
export const GET = (request) => prefetchHandler(request);
