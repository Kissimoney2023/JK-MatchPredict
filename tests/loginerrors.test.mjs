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

test('a rejected API key is reported as a configuration problem, without naming the key', () => {
  for (const [status, body] of [
    [401, '{"message":"Invalid API key"}'],
    [403, '{"message":"forbidden"}'],
    [400, '{"msg":"Invalid JWT"}'],
  ]) {
    const message = authFailure(status, body);
    assert.match(message, /rejected this site's API key/);
    assert.match(message, /SUPABASE_PUBLISHABLE_KEY/);
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
