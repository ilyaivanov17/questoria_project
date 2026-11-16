import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const apiBase = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const demoQuestSlug = 'mystery-of-the-missing-number';

async function waitForApi() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Questoria API did not become ready: ${String(lastError ?? '')}`);
}

async function request(path, options = {}, cookie = undefined) {
  const headers = new Headers(options.headers ?? {});
  if (cookie) headers.set('Cookie', cookie);
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, body };
}

function extractCookie(response) {
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'registration/login must set a session cookie');
  assert.match(setCookie, /HttpOnly/i, 'session cookie must be HttpOnly');
  return setCookie.split(';', 1)[0];
}

await waitForApi();

const email = `smoke-${randomUUID()}@questoria.test`;
const password = 'Questoria-smoke-password-2026';
const registration = await request('/api/v1/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, nickname: 'Smoke Tester' }),
});
assert.equal(registration.response.status, 201);
assert.ok(registration.body?.user?.id);
let userCookie = extractCookie(registration.response);
assert.equal('token' in registration.body, false, 'raw session token must not be returned in JSON');

const me = await request('/api/v1/auth/me', {}, userCookie);
assert.equal(me.response.status, 200);
assert.equal(me.body?.user?.email, email);

const categories = await request('/api/v1/public/categories');
assert.equal(categories.response.status, 200);
assert.ok(categories.body.some((category) =>
  category.quests.some((quest) => quest.slug === demoQuestSlug),
));

const publicQuest = await request(`/api/v1/public/quests/${demoQuestSlug}`);
assert.equal(publicQuest.response.status, 200);
const publicQuestJson = JSON.stringify(publicQuest.body);
assert.equal(publicQuestJson.includes('correctOptionId'), false, 'public quest payload leaked the answer');
assert.equal(publicQuestJson.includes('solution_private'), false);

const started = await request('/api/v1/runs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug: demoQuestSlug }),
}, userCookie);
assert.equal(started.response.status, 201);
assert.ok(started.body?.id);
const runId = started.body.id;

const loadedRun = await request(`/api/v1/runs/${runId}`, {}, userCookie);
assert.equal(loadedRun.response.status, 200);
assert.equal(loadedRun.body.status, 'IN_PROGRESS');
const puzzle = loadedRun.body.currentPuzzle;
assert.ok(puzzle?.id);
assert.equal(puzzle.type, 'single_choice');
assert.ok(puzzle.options.some((option) => option.id === 'opt_32'));

const wrongAttemptId = randomUUID();
const wrongRequest = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ attemptId: wrongAttemptId, answer: { optionId: 'opt_24' } }),
};
const wrong = await request(
  `/api/v1/runs/${runId}/puzzles/${puzzle.id}/attempts`,
  wrongRequest,
  userCookie,
);
assert.equal(wrong.response.status, 201);
assert.equal(wrong.body.result, 'incorrect');
assert.equal(wrong.body.attemptsRemaining, 2);
assert.equal(wrong.body.attemptId, wrongAttemptId);

const replay = await request(
  `/api/v1/runs/${runId}/puzzles/${puzzle.id}/attempts`,
  wrongRequest,
  userCookie,
);
assert.equal(replay.response.status, 201);
assert.equal(replay.body.attemptId, wrongAttemptId);
assert.equal(replay.body.attemptsRemaining, 2, 'idempotent replay must not consume another attempt');

const correctAttemptId = randomUUID();
const correct = await request(
  `/api/v1/runs/${runId}/puzzles/${puzzle.id}/attempts`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attemptId: correctAttemptId, answer: { optionId: 'opt_32' } }),
  },
  userCookie,
);
assert.equal(correct.response.status, 201);
assert.equal(correct.body.result, 'correct');
assert.equal(correct.body.scoreAwarded, 10);
assert.equal(correct.body.attemptId, correctAttemptId);

const completed = await request(`/api/v1/runs/${runId}/result`, {}, userCookie);
assert.equal(completed.response.status, 200);
assert.equal(completed.body.status, 'COMPLETED');
assert.equal(completed.body.result.success, true);
assert.equal(completed.body.result.score, 10);

const logout = await request('/api/v1/auth/logout', { method: 'POST' }, userCookie);
assert.equal(logout.response.status, 204);
userCookie = '';

const afterLogout = await request('/api/v1/auth/me');
assert.equal(afterLogout.response.status, 401);

const login = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert.equal(login.response.status, 200);
userCookie = extractCookie(login.response);

const resumed = await request(`/api/v1/runs/${runId}`, {}, userCookie);
assert.equal(resumed.response.status, 200);
assert.equal(resumed.body.status, 'COMPLETED');

const secondEmail = `smoke-${randomUUID()}@questoria.test`;
const secondUser = await request('/api/v1/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: secondEmail, password, nickname: 'Another User' }),
});
assert.equal(secondUser.response.status, 201);
const otherCookie = extractCookie(secondUser.response);
const forbiddenRun = await request(`/api/v1/runs/${runId}`, {}, otherCookie);
assert.equal(forbiddenRun.response.status, 404, 'users must not access another profile run');

process.stdout.write('Questoria E2E smoke test passed: registration, sessions, quest run, answer validation, idempotency, persistence and ownership.\n');
