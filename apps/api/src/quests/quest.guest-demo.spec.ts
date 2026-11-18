import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { QuestService } from './quest.service.js';

const fixture = {
  slug: 'demo-quest',
  versions: [{
    title: 'Demo mission',
    levels: [{
      puzzles: [{
        type: 'single_choice',
        publicPayload: {
          prompt: 'Какой вариант правильный?',
          options: [
            { id: 'correct', label: 'Правильный' },
            { id: 'wrong', label: 'Неправильный' },
          ],
        },
        solutionPrivate: {
          correctOptionId: 'correct',
          correctFeedback: 'Верно! Объяснение.',
          incorrectFeedback: 'Попробуй ещё раз.',
        },
        hints: [{ body: 'Внимательно прочитай условие.' }],
      }],
    }],
  }],
};

function createService(result: unknown = fixture) {
  const calls: unknown[] = [];
  const prisma = {
    quest: {
      findFirst: async (query: unknown) => {
        calls.push(query);
        return result;
      },
    },
  } as unknown as PrismaService;
  return { service: new QuestService(prisma), calls };
}

test('guest demo preview exposes only the first published puzzle public payload', async () => {
  const { service, calls } = createService();

  const preview = await service.getGuestDemoPreview('demo-quest');

  assert.deepEqual(preview, {
    slug: 'demo-quest',
    questTitle: 'Demo mission',
    puzzle: {
      type: 'single_choice',
      prompt: 'Какой вариант правильный?',
      options: [
        { id: 'correct', label: 'Правильный' },
        { id: 'wrong', label: 'Неправильный' },
      ],
      items: [],
      placeholder: null,
      unit: null,
      hints: ['Внимательно прочитай условие.'],
    },
  });
  assert.equal(JSON.stringify(preview).includes('solutionPrivate'), false);
  assert.equal(JSON.stringify(preview).includes('correctOptionId'), false);
  assert.equal(calls.length, 1);

  const query = calls[0] as {
    where: { slug: string; status: string };
    select: { versions: { where: { status: string }; select: { levels: { take: number; select: { puzzles: { take: number } } } } } };
  };
  assert.deepEqual(query.where, { slug: 'demo-quest', status: 'PUBLISHED' });
  assert.equal(query.select.versions.where.status, 'PUBLISHED');
  assert.equal(query.select.versions.select.levels.take, 1);
  assert.equal(query.select.versions.select.levels.select.puzzles.take, 1);
});

test('guest demo checks answers on the server and always returns zero rewards without persistence', async () => {
  const { service, calls } = createService();

  const correct = await service.submitGuestDemoAttempt('demo-quest', {
    answer: { optionId: 'correct' },
  });
  assert.deepEqual(correct, {
    result: 'correct',
    feedback: 'Верно! Объяснение.',
    progressSaved: false,
    rewards: { xp: 0, coins: 0 },
  });

  const incorrect = await service.submitGuestDemoAttempt('demo-quest', {
    answer: { optionId: 'wrong' },
  });
  assert.deepEqual(incorrect, {
    result: 'incorrect',
    feedback: 'Попробуй ещё раз.',
    progressSaved: false,
    rewards: { xp: 0, coins: 0 },
  });
  assert.equal(calls.length, 2);
});

test('guest demo is unavailable when there is no published quest or sample puzzle', async () => {
  const { service: missingQuest } = createService(null);
  assert.equal(await missingQuest.getGuestDemoPreview('missing'), null);
  assert.equal(await missingQuest.submitGuestDemoAttempt('missing', { answer: { optionId: 'x' } }), null);

  const { service: missingPuzzle } = createService({
    slug: 'empty',
    versions: [{ title: 'Empty', levels: [{ puzzles: [] }] }],
  });
  assert.equal(await missingPuzzle.getGuestDemoPreview('empty'), null);
});

test('guest demo rejects malformed answers instead of accepting client-side correctness', async () => {
  const { service } = createService();

  await assert.rejects(
    () => service.submitGuestDemoAttempt('demo-quest', { answer: { optionId: 'not-public' } }),
    BadRequestException,
  );
});
