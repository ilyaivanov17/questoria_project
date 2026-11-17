import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createTotpCode } from '../apps/api/dist/admin/totp.js';

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
  assert.ok(setCookie, 'login must set a session cookie');
  assert.match(setCookie, /HttpOnly/i, 'session cookie must be HttpOnly');
  return setCookie.split(';', 1)[0];
}

async function waitForEmailLinks(email, kind, minimum = 1) {
  const logFile = process.env.API_LOG_FILE ?? '/tmp/questoria-api.log';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const log = await readFile(logFile, 'utf8').catch(() => '');
    const messages = [];

    for (const line of log.split('\n')) {
      const marker = 'QUESTORIA_EMAIL ';
      const markerIndex = line.indexOf(marker);
      if (markerIndex < 0) continue;
      try {
        const message = JSON.parse(line.slice(markerIndex + marker.length));
        if (message.email === email && message.kind === kind && typeof message.url === 'string') {
          messages.push(message);
        }
      } catch {
        // Ignore unrelated or partially written log lines.
      }
    }

    if (messages.length >= minimum) return messages;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for ' + kind + ' email for ' + email + '.');
}

function tokenFromMessage(message) {
  const token = new URL(message.url).searchParams.get('token');
  assert.ok(token, 'email action URL must contain a token');
  return token;
}

async function submit(runId, puzzle, answer, cookie) {
  const attemptId = randomUUID();
  const result = await request(
    `/api/v1/runs/${runId}/puzzles/${puzzle.id}/attempts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId, answer }),
    },
    cookie,
  );
  return { ...result, attemptId };
}

const expectedAnswers = [
  { type: 'single_choice', answer: { optionId: 'opt_32' } },
  { type: 'multiple_choice', answer: { optionIds: ['doubles', 'even'] } },
  { type: 'numeric_input', answer: { value: '64' } },
  { type: 'text_input', answer: { text: 'УДВОЕНИЕ' } },
  {
    type: 'ordering',
    answer: { orderedIds: ['two', 'four', 'eight', 'sixteen', 'thirty_two'] },
  },
];

await waitForApi();

const liveness = await request('/api/health', {
  headers: { 'x-request-id': 'questoria-smoke-0001' },
});
assert.equal(liveness.response.status, 200);
assert.equal(liveness.body?.status, 'ok');
assert.equal(liveness.response.headers.get('x-request-id'), 'questoria-smoke-0001');

const readiness = await request('/api/health/ready');
assert.equal(readiness.response.status, 200);
assert.equal(readiness.body?.status, 'ready');
assert.equal(readiness.body?.checks?.database, 'ok');
assert.match(
  readiness.response.headers.get('x-request-id') ?? '',
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
);

const email = `smoke-${randomUUID()}@questoria.test`;
const password = 'Questoria-smoke-password-2026';
const registration = await request('/api/v1/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, nickname: 'Smoke Tester' }),
});
assert.equal(registration.response.status, 201);
assert.equal(registration.body?.emailSent, true);
assert.equal(registration.response.headers.get('set-cookie'), null, 'pending accounts must not receive a session');
assert.equal('token' in (registration.body ?? {}), false, 'email tokens must not be returned in JSON');

const verificationMessage = (await waitForEmailLinks(email, 'verification'))[0];
const verificationToken = tokenFromMessage(verificationMessage);
const unverifiedLogin = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert.equal(unverifiedLogin.response.status, 403, 'unverified accounts must not sign in');

const verified = await request('/api/v1/auth/verify-email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: verificationToken }),
});
assert.equal(verified.response.status, 200);
const reusedVerification = await request('/api/v1/auth/verify-email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: verificationToken }),
});
assert.equal(reusedVerification.response.status, 403, 'verification tokens must be single-use');

const initialLogin = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert.equal(initialLogin.response.status, 200);
let userCookie = extractCookie(initialLogin.response);

const me = await request('/api/v1/auth/me', {}, userCookie);
assert.equal(me.response.status, 200);
assert.equal(me.body?.user?.email, email);

const adminIdentityDenied = await request('/api/v1/admin/me', {}, userCookie);
assert.equal(adminIdentityDenied.response.status, 403, 'ordinary learners must not access CMS identity');
const adminContentDenied = await request('/api/v1/admin/categories', {}, userCookie);
assert.equal(adminContentDenied.response.status, 403, 'ordinary learners must not list CMS categories');

const categories = await request('/api/v1/public/categories');
assert.equal(categories.response.status, 200);
assert.ok(categories.body.some((category) =>
  category.quests.some((quest) => quest.slug === demoQuestSlug),
));

const publicQuest = await request(`/api/v1/public/quests/${demoQuestSlug}`);
assert.equal(publicQuest.response.status, 200);
const publicQuestJson = JSON.stringify(publicQuest.body);
assert.equal(publicQuestJson.includes('correctOptionId'), false, 'public quest payload leaked the answer');
assert.equal(publicQuestJson.includes('correctOptionIds'), false, 'public quest payload leaked multiple-choice answers');
assert.equal(publicQuestJson.includes('correctValue'), false, 'public quest payload leaked numeric answers');
assert.equal(publicQuestJson.includes('acceptedAnswers'), false, 'public quest payload leaked text answers');
assert.equal(publicQuestJson.includes('correctOrderIds'), false, 'public quest payload leaked ordering answers');
assert.equal(publicQuestJson.includes('solution_private'), false);
const publicPuzzleTypes = publicQuest.body.levels.flatMap((level) => level.puzzles.map((puzzle) => puzzle.type));
assert.deepEqual(publicPuzzleTypes, expectedAnswers.map((item) => item.type));

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
let currentPuzzle = loadedRun.body.currentPuzzle;
assert.ok(currentPuzzle?.id);
assert.equal(currentPuzzle.type, 'single_choice');
assert.ok(currentPuzzle.options.some((option) => option.id === 'opt_32'));

const wrongAttemptId = randomUUID();
const wrongRequest = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ attemptId: wrongAttemptId, answer: { optionId: 'opt_24' } }),
};
const wrong = await request(
  `/api/v1/runs/${runId}/puzzles/${currentPuzzle.id}/attempts`,
  wrongRequest,
  userCookie,
);
assert.equal(wrong.response.status, 201);
assert.equal(wrong.body.result, 'incorrect');
assert.equal(wrong.body.attemptsRemaining, 2);
assert.equal(wrong.body.attemptId, wrongAttemptId);

const replay = await request(
  `/api/v1/runs/${runId}/puzzles/${currentPuzzle.id}/attempts`,
  wrongRequest,
  userCookie,
);
assert.equal(replay.response.status, 201);
assert.equal(replay.body.attemptId, wrongAttemptId);
assert.equal(replay.body.attemptsRemaining, 2, 'idempotent replay must not consume another attempt');

const correctFirst = await submit(runId, currentPuzzle, { optionId: 'opt_32' }, userCookie);
assert.equal(correctFirst.response.status, 201);
assert.equal(correctFirst.body.result, 'correct');
assert.equal(correctFirst.body.scoreAwarded, 10);
assert.equal(correctFirst.body.runCompleted, false);
assert.deepEqual(correctFirst.body.rewards, { xp: 0, coins: 0, firstCompletion: false });

const firstReplay = await request(
  `/api/v1/runs/${runId}/puzzles/${currentPuzzle.id}/attempts`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attemptId: correctFirst.attemptId, answer: { optionId: 'opt_32' } }),
  },
  userCookie,
);
assert.equal(firstReplay.response.status, 201);
assert.deepEqual(firstReplay.body.rewards, { xp: 0, coins: 0, firstCompletion: false });

let finalAttempt = null;
for (const expected of expectedAnswers.slice(1)) {
  const state = await request(`/api/v1/runs/${runId}`, {}, userCookie);
  assert.equal(state.response.status, 200);
  currentPuzzle = state.body.currentPuzzle;
  assert.equal(currentPuzzle.type, expected.type);
  if (expected.type === 'ordering') {
    assert.equal(currentPuzzle.items.length, 5);
  }
  const result = await submit(runId, currentPuzzle, expected.answer, userCookie);
  assert.equal(result.response.status, 201, `${expected.type} submission should be accepted`);
  assert.equal(result.body.result, 'correct', `${expected.type} answer should be marked correct`);
  finalAttempt = result;
}

assert.ok(finalAttempt);
assert.equal(finalAttempt.body.runCompleted, true);
assert.deepEqual(finalAttempt.body.rewards, { xp: 40, coins: 15, firstCompletion: true });

const completed = await request(`/api/v1/runs/${runId}/result`, {}, userCookie);
assert.equal(completed.response.status, 200);
assert.equal(completed.body.status, 'COMPLETED');
assert.equal(completed.body.result.success, true);
assert.equal(completed.body.result.score, 50);
assert.equal(completed.body.result.attempts, 6);
assert.deepEqual(completed.body.result.rewards, {
  xp: 40,
  coins: 15,
  firstCompletion: true,
});

const profile = await request('/api/v1/me/profile', {}, userCookie);
assert.equal(profile.response.status, 200);
assert.equal(profile.body.wallet.xp, 40);
assert.equal(profile.body.wallet.coins, 15);
assert.equal(profile.body.stats.completedQuests, 1);

const progress = await request('/api/v1/me/progress', {}, userCookie);
assert.equal(progress.response.status, 200);
assert.equal(progress.body.stats.completedQuests, 1);
assert.equal(progress.body.stats.completedRuns, 1);

const wallet = await request('/api/v1/me/wallet', {}, userCookie);
assert.equal(wallet.response.status, 200);
assert.equal(wallet.body.balances.xp, 40);
assert.equal(wallet.body.balances.coins, 15);
assert.equal(wallet.body.entries.length, 6, 'one completed level, quest and final puzzle each produce XP and coin entries');

const profileUpdate = await request('/api/v1/me/profile', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nickname: 'Smoke Champion' }),
}, userCookie);
assert.equal(profileUpdate.response.status, 200);
assert.equal(profileUpdate.body.nickname, 'Smoke Champion');

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

const replayRun = await request('/api/v1/runs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ slug: demoQuestSlug }),
}, userCookie);
assert.equal(replayRun.response.status, 201);
const replayRunId = replayRun.body.id;
let replayState = replayRun.body;
let replayCompletion = null;
for (const expected of expectedAnswers) {
  assert.equal(replayState.currentPuzzle.type, expected.type);
  replayCompletion = await submit(replayRunId, replayState.currentPuzzle, expected.answer, userCookie);
  assert.equal(replayCompletion.response.status, 201);
  assert.equal(replayCompletion.body.result, 'correct');
  replayState = await request(`/api/v1/runs/${replayRunId}`, {}, userCookie).then((result) => result.body);
}

assert.ok(replayCompletion);
assert.equal(replayCompletion.body.runCompleted, true);
assert.deepEqual(replayCompletion.body.rewards, { xp: 0, coins: 0, firstCompletion: false });

const walletAfterReplay = await request('/api/v1/me/wallet', {}, userCookie);
assert.equal(walletAfterReplay.body.balances.xp, 40);
assert.equal(walletAfterReplay.body.balances.coins, 15);

const forgot = await request('/api/v1/auth/forgot-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email }),
});
assert.equal(forgot.response.status, 202);
const unknownForgot = await request('/api/v1/auth/forgot-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'missing-' + randomUUID() + '@questoria.test' }),
});
assert.equal(unknownForgot.response.status, 202);
assert.deepEqual(unknownForgot.body, forgot.body, 'password reset must not disclose whether an email exists');

const resetMessage = (await waitForEmailLinks(email, 'password-reset'))[0];
const resetToken = tokenFromMessage(resetMessage);
const newPassword = 'Questoria-new-password-2026';
const reset = await request('/api/v1/auth/reset-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: resetToken, password: newPassword }),
});
assert.equal(reset.response.status, 200);

const revokedSession = await request('/api/v1/auth/me', {}, userCookie);
assert.equal(revokedSession.response.status, 401, 'password reset must revoke every session');
const reusedReset = await request('/api/v1/auth/reset-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: resetToken, password: 'Another-new-password-2026' }),
});
assert.equal(reusedReset.response.status, 403, 'password reset tokens must be single-use');

const oldPasswordLogin = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert.equal(oldPasswordLogin.response.status, 401);
const newPasswordLogin = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: newPassword }),
});
assert.equal(newPasswordLogin.response.status, 200);
userCookie = extractCookie(newPasswordLogin.response);

const secondEmail = 'smoke-' + randomUUID() + '@questoria.test';
const secondUser = await request('/api/v1/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: secondEmail, password, nickname: 'Another User' }),
});
assert.equal(secondUser.response.status, 201);
assert.equal(secondUser.body?.emailSent, true);

const resend = await request('/api/v1/auth/resend-verification', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: secondEmail }),
});
assert.equal(resend.response.status, 202);
const secondVerificationMessages = await waitForEmailLinks(secondEmail, 'verification', 2);
const firstSecondUserToken = tokenFromMessage(secondVerificationMessages[0]);
const latestSecondUserToken = tokenFromMessage(secondVerificationMessages[secondVerificationMessages.length - 1]);
const staleVerification = await request('/api/v1/auth/verify-email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: firstSecondUserToken }),
});
assert.equal(staleVerification.response.status, 403, 'resending must invalidate earlier verification links');

const secondVerified = await request('/api/v1/auth/verify-email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: latestSecondUserToken }),
});
assert.equal(secondVerified.response.status, 200);
const secondLogin = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: secondEmail, password }),
});
assert.equal(secondLogin.response.status, 200);
const otherCookie = extractCookie(secondLogin.response);
const forbiddenRun = await request('/api/v1/runs/' + runId, {}, otherCookie);
assert.equal(forbiddenRun.response.status, 404, 'users must not access another profile run');

const roleGrant = spawnSync(
  'pnpm',
  ['--filter', '@questoria/api', 'admin:grant-role', email, 'SUPER_ADMIN'],
  {
    encoding: 'utf8',
    env: { ...process.env, QUESTORIA_ALLOW_ROLE_GRANT: '1' },
  },
);
assert.equal(
  roleGrant.status,
  0,
  'explicit bootstrap role grant should succeed: ' + String(roleGrant.stderr ?? ''),
);

const adminIdentity = await request('/api/v1/admin/me', {}, userCookie);
assert.equal(adminIdentity.response.status, 200);
assert.ok(adminIdentity.body?.user?.roleKeys?.includes('SUPER_ADMIN'));

const adminOriginHeaders = {
  Origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  'Content-Type': 'application/json',
};
const mfaSetup = await request('/api/v1/admin/mfa/setup', {
  method: 'POST',
  headers: adminOriginHeaders,
}, userCookie);
assert.equal(mfaSetup.response.status, 201);
assert.ok(mfaSetup.body?.secret);

const totpCode = createTotpCode(mfaSetup.body.secret);
const enabledMfa = await request('/api/v1/admin/mfa/verify', {
  method: 'POST',
  headers: adminOriginHeaders,
  body: JSON.stringify({ code: totpCode }),
}, userCookie);
assert.equal(enabledMfa.response.status, 201);
assert.equal(enabledMfa.body?.recoveryCodes?.length, 10);
assert.equal(enabledMfa.body?.recoveryCodesRemaining, 10);
const firstRecoveryBatch = enabledMfa.body.recoveryCodes;

const recoveryStatus = await request('/api/v1/admin/mfa/recovery-codes/status', {}, userCookie);
assert.equal(recoveryStatus.response.status, 200);
assert.equal(recoveryStatus.body.remaining, 10);

const consumeRecovery = await request('/api/v1/admin/mfa/recovery-codes/use', {
  method: 'POST',
  headers: adminOriginHeaders,
  body: JSON.stringify({ code: firstRecoveryBatch[0] }),
}, userCookie);
assert.equal(consumeRecovery.response.status, 201);
assert.equal(consumeRecovery.body.verified, true);
assert.equal(consumeRecovery.body.remaining, 9);

const reusedRecovery = await request('/api/v1/admin/mfa/recovery-codes/use', {
  method: 'POST',
  headers: adminOriginHeaders,
  body: JSON.stringify({ code: firstRecoveryBatch[0] }),
}, userCookie);
assert.equal(reusedRecovery.response.status, 401, 'a recovery code must only work once');

const refreshedCodes = await request('/api/v1/admin/mfa/recovery-codes/regenerate', {
  method: 'POST',
  headers: adminOriginHeaders,
  body: JSON.stringify({ code: createTotpCode(mfaSetup.body.secret) }),
}, userCookie);
assert.equal(refreshedCodes.response.status, 201);
assert.equal(refreshedCodes.body.codes.length, 10);
assert.equal(refreshedCodes.body.remaining, 10);

const revokedOldCode = await request('/api/v1/admin/mfa/recovery-codes/use', {
  method: 'POST',
  headers: adminOriginHeaders,
  body: JSON.stringify({ code: firstRecoveryBatch[1] }),
}, userCookie);
assert.equal(revokedOldCode.response.status, 401, 'regeneration must revoke every previous code');

const consumeFreshCode = await request('/api/v1/admin/mfa/recovery-codes/use', {
  method: 'POST',
  headers: adminOriginHeaders,
  body: JSON.stringify({ code: refreshedCodes.body.codes[0] }),
}, userCookie);
assert.equal(consumeFreshCode.response.status, 201);
assert.equal(consumeFreshCode.body.remaining, 9);


const adminUserId = adminIdentity.body.user.userId;

// Create another login and verify that the current MFA session can inspect and revoke it.
const extraLogin = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: newPassword }),
});
assert.equal(extraLogin.response.status, 200);
const extraCookie = extractCookie(extraLogin.response);

const sessionInventory = await request('/api/v1/admin/users/' + adminUserId + '/sessions', {}, userCookie);
assert.equal(sessionInventory.response.status, 200);
assert.ok(Array.isArray(sessionInventory.body.sessions));
assert.ok(sessionInventory.body.sessions.some((session) => session.isCurrent), 'session inventory must identify the current session');
assert.ok(sessionInventory.body.sessions.some((session) => !session.isCurrent), 'session inventory must show the second login');
assert.equal(JSON.stringify(sessionInventory.body).includes('tokenHash'), false, 'session inventory must never expose token hashes');

const currentSession = sessionInventory.body.sessions.find((session) => session.isCurrent);
const extraSession = sessionInventory.body.sessions.find((session) => !session.isCurrent);
const currentRevoke = await request('/api/v1/admin/users/' + adminUserId + '/sessions/' + currentSession.id, {
  method: 'DELETE',
  headers: adminOriginHeaders,
  body: JSON.stringify({ reason: 'Security smoke current-session guard' }),
}, userCookie);
assert.equal(currentRevoke.response.status, 403, 'the current session must never revoke itself');

const singleRevoke = await request('/api/v1/admin/users/' + adminUserId + '/sessions/' + extraSession.id, {
  method: 'DELETE',
  headers: adminOriginHeaders,
  body: JSON.stringify({ reason: 'Security smoke single-session revoke' }),
}, userCookie);
assert.equal(singleRevoke.response.status, 200);
assert.equal(singleRevoke.body.revoked, true);
const extraSessionDenied = await request('/api/v1/auth/me', {}, extraCookie);
assert.equal(extraSessionDenied.response.status, 401, 'revoked session must no longer authenticate');

const secondExtraLogin = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: newPassword }),
});
assert.equal(secondExtraLogin.response.status, 200);
const secondExtraCookie = extractCookie(secondExtraLogin.response);
const revokeOthers = await request('/api/v1/admin/users/' + adminUserId + '/sessions/revoke-others', {
  method: 'POST',
  headers: adminOriginHeaders,
  body: JSON.stringify({ reason: 'Security smoke revoke all other sessions' }),
}, userCookie);
assert.equal(revokeOthers.response.status, 201);
assert.equal(revokeOthers.body.revokedCount, 1);
assert.equal(revokeOthers.body.currentSessionPreserved, true);
const secondExtraDenied = await request('/api/v1/auth/me', {}, secondExtraCookie);
assert.equal(secondExtraDenied.response.status, 401, 'revoke-others must invalidate other sessions');
const currentStillValid = await request('/api/v1/auth/me', {}, userCookie);
assert.equal(currentStillValid.response.status, 200, 'revoke-others must preserve the current admin session');

const auditQuery = new URLSearchParams({
  take: '10',
  action: 'security.user_session',
  actor: email,
  entityType: 'USER',
});
const filteredAudit = await request('/api/v1/admin/audit-logs?' + auditQuery.toString(), {}, userCookie);
assert.equal(filteredAudit.response.status, 200);
assert.ok(Array.isArray(filteredAudit.body.items));
assert.ok(filteredAudit.body.total >= 2, 'filtered audit page must include the two session-revocation actions');
assert.ok(filteredAudit.body.items.every((entry) => entry.action.includes('security.user_session')));
assert.ok(filteredAudit.body.items.every((entry) => entry.actor?.emailNormalized === email));
assert.ok(filteredAudit.body.items.some((entry) => entry.reason), 'session audit entries must include their reason');

const auditExport = await request('/api/v1/admin/audit-logs/export?' + auditQuery.toString(), {}, userCookie);
assert.equal(auditExport.response.status, 200);
assert.ok(auditExport.body.exported >= 2);
assert.equal(auditExport.body.truncated, false);
assert.equal(JSON.stringify(auditExport.body).includes('tokenHash'), false, 'audit export must not expose session token hashes');
assert.equal(JSON.stringify(auditExport.body).includes('passwordHash'), false, 'audit export must not expose password hashes');

const invalidAuditRange = await request('/api/v1/admin/audit-logs?from=2026-11-18&to=2026-11-17', {}, userCookie);
assert.equal(invalidAuditRange.response.status, 400, 'invalid date ranges must be rejected');

process.stdout.write('Questoria E2E smoke test passed: email verification, password recovery, MFA recovery codes, session revocation, auth, five puzzle types, XP/coin ledger, profile and ownership.\n');
