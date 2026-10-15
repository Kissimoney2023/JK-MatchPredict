import {shareHandler} from '../server/handler.mjs';

// Vercel Function behind /s/<id> (see the rewrite in vercel.json): the public share page.
export const GET = (request) => shareHandler(request);
