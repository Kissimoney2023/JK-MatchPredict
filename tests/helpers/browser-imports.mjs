// Lets Node run browser view modules in tests. The page imports the shared modules by their
// published root paths ("/value.js"); this maps those to their sources under server/.
import {register} from 'node:module';

register('./browser-imports-hook.mjs', import.meta.url);
