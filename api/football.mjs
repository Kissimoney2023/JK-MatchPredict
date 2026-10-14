import {handler} from '../server/handler.mjs';

// Vercel Function (Web-standard Request/Response). Served at /api/football.
export const GET = (request) => handler(request);
export const POST = (request) => handler(request);
