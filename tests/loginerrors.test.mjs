import test from 'node:test';
import assert from 'node:assert/strict';
import {authFailure, createSupabase} from '../server/supabase.mjs';

test('an expired or reused sign-in code is explained as such', () => {
  for (const body of [
    '{"error":"invalid_grant"}',
    '{"code":400,"error_code":"flow_state_not_found","msg":"invalid flow state"}',
    '{"error_code":"bad_code_verifier","msg":"code challenge does not match previously saved code verifier"}',
    '{"error_code":"flow_state_expired"}',
  ])
    assert.match(
      authFailure(400, body),
      /could not be completed: that attempt expired or was already used/,
      body,
    );
});

test('a rejected key says which key to fix, without echoing any key', () => {
  for (const [status, body] of [
    [401, '{"message":"Invalid API key"}'],
    [403, '{"message":"forbidden"}'],
    [400, '{"msg":"Invalid JWT"}'],
  ]) {
    const set = authFailure(status, body);
    assert.match(set, /refused the publishable key set in SUPABASE_PUBLISHABLE_KEY/);
    assert.match(set, /no quotes or spaces/);
    const missing = authFailure(status, body, {fallbackKey: true});
    assert.match(missing, /SUPABASE_PUBLISHABLE_KEY is not set/);
    assert.match(missing, /secret key was tried/);
    assert.ok(!/sb_(secret|publishable)_[A-Za-z0-9]/.test(set + missing), 'no key material');
  }
});

test('rate limiting and unknown failures say what they can and nothing unsafe', () => {
  assert.match(authFailure(429, '{"error_code":"over_request_rate_limit"}'), /too many attempts/);
  assert.equal(
    authFailure(
      400,
      '{"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}',
    ),
    'Sign-in could not be completed (Supabase says: validation_failed). Please try again.',
  );
  // Odd codes are not echoed back, and non-JSON bodies still give a sensible message.
  assert.equal(
    authFailure(400, '{"error_code":"<script>alert(1)</script>"}'),
    'Sign-in could not be completed. Please try again.',
  );
  assert.equal(
    authFailure(400, '<html>oops</html>'),
    'Sign-in could not be completed. Please try again.',
  );
  assert.equal(authFailure(400, ''), 'Sign-in could not be completed. Please try again.');
});

test('the code exchange turns a Supabase refusal into that explanation', async () => {
  const supabase = createSupabase({
    url: 'https://proj.supabase.co',
    key: 'sb_secret_x',
    authKey: 'sb_publishable_x',
    fetcher: async () => Response.json({error_code: 'flow_state_not_found'}, {status: 404}),
  });
  await assert.rejects(() => supabase.exchangeCode('code', 'verifier'), {
    status: 400,
    code: 'auth',
    message: /expired or was already used/,
  });
  const down = createSupabase({
    url: 'https://proj.supabase.co',
    key: 'sb_secret_x',
    fetcher: async () => Response.json({}, {status: 503}),
  });
  await assert.rejects(() => down.exchangeCode('c', 'v'), /temporarily unavailable/);
});

test('keys pasted with quotes, spaces or a newline are cleaned before use', async () => {
  const seen = [];
  const supabase = createSupabase({
    url: ' "https://proj.supabase.co/" \n',
    key: '  "sb_secret_abc"\n',
    authKey: " 'sb_publishable_xyz' \r\n",
    fetcher: async (url, options) => {
      seen.push({url, apikey: options.headers.apikey});
      return Response.json([]);
    },
  });
  await supabase.select('picks', {limit: '1'});
  await supabase.exchangeCode('code', 'verifier').catch(() => {});
  assert.equal(seen[0].url.startsWith('https://proj.supabase.co/rest/v1/picks'), true);
  assert.equal(seen[0].apikey, 'sb_secret_abc', 'table calls use the secret key');
  assert.equal(
    seen[1].apikey,
    'sb_publishable_xyz',
    'the sign-in exchange uses the publishable key',
  );
});

test('without a publishable key the exchange falls back to the secret key and says so when refused', async () => {
  const supabase = createSupabase({
    url: 'https://proj.supabase.co',
    key: 'sb_secret_abc',
    fetcher: async () => Response.json({message: 'Invalid API key'}, {status: 401}),
  });
  await assert.rejects(
    () => supabase.exchangeCode('c', 'v'),
    /SUPABASE_PUBLISHABLE_KEY is not set/,
  );
});
