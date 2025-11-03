// RLS sanity tests for profiles and posts
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   TEST_USER_A_EMAIL=... TEST_USER_A_PASSWORD=... \
//   TEST_USER_B_EMAIL=... TEST_USER_B_PASSWORD=... \
//   node scripts/rls-test.js

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const USER_A_EMAIL = process.env.TEST_USER_A_EMAIL;
const USER_A_PASSWORD = process.env.TEST_USER_A_PASSWORD;
const USER_B_EMAIL = process.env.TEST_USER_B_EMAIL;
const USER_B_PASSWORD = process.env.TEST_USER_B_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY env.');
  process.exit(1);
}
if (!USER_A_EMAIL || !USER_A_PASSWORD || !USER_B_EMAIL || !USER_B_PASSWORD) {
  console.error('Missing test user credentials env.');
  process.exit(1);
}

const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function signInOrSignUp(email, password) {
  // Try sign in first
  let { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) {
    // Try sign up; requires email confirmation OFF in dev
    const { data: signUpData, error: signUpErr } = await anon.auth.signUp({ email, password });
    if (signUpErr) throw signUpErr;
    signInData = signUpData;
  }
  if (!signInData.session) throw new Error('No session after auth');
  return signInData.session;
}

function clientForToken(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function upsertProfile(supabase, userId, username) {
  const { error } = await supabase.from('profiles').upsert({ id: userId, username });
  if (error) throw error;
}

async function insertPost(supabase, userId, text) {
  const { data, error } = await supabase
    .from('posts')
    .insert({ author_id: userId, text_content: text })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function tryUpdatePost(supabase, postId, text) {
  const { error } = await supabase
    .from('posts')
    .update({ text_content: text })
    .eq('id', postId);
  return error;
}

async function main() {
  console.log('Signing in User A...');
  const aSession = await signInOrSignUp(USER_A_EMAIL, USER_A_PASSWORD);
  const aClient = clientForToken(aSession.access_token);
  const aId = aSession.user.id;
  await upsertProfile(aClient, aId, 'alice');
  const aPostId = await insertPost(aClient, aId, 'Hello from Alice');
  console.log('User A post id:', aPostId);

  console.log('Signing in User B...');
  const bSession = await signInOrSignUp(USER_B_EMAIL, USER_B_PASSWORD);
  const bClient = clientForToken(bSession.access_token);
  const bId = bSession.user.id;
  await upsertProfile(bClient, bId, 'bob');
  const bPostId = await insertPost(bClient, bId, 'Hello from Bob');
  console.log('User B post id:', bPostId);

  console.log('RLS test: User A tries to update User B post (should fail)...');
  const errAB = await tryUpdatePost(aClient, bPostId, 'Updated by Alice (should fail)');
  if (!errAB) throw new Error('RLS FAILED: User A updated User B post');
  console.log('As expected, update was denied:', errAB.message);

  console.log('RLS test: User A updates own post (should succeed)...');
  const errAA = await tryUpdatePost(aClient, aPostId, 'Updated by Alice');
  if (errAA) throw new Error('RLS FAILED: User A could not update own post: ' + errAA.message);
  console.log('Success: User A updated own post.');

  console.log('All RLS tests passed.');
}

main().catch((e) => {
  console.error('Test run failed:', e);
  process.exit(1);
});


