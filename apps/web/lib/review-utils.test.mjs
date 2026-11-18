import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getEvidenceTypeLabel,
  getReviewTimingLabel,
  getSkillStatusLabel,
  pluralizeRussianDays,
} from './review-utils.mjs';

test('Russian day labels cover singular, paucal, plural and teens', () => {
  assert.equal(pluralizeRussianDays(1), '1 день');
  assert.equal(pluralizeRussianDays(2), '2 дня');
  assert.equal(pluralizeRussianDays(4), '4 дня');
  assert.equal(pluralizeRussianDays(5), '5 дней');
  assert.equal(pluralizeRussianDays(11), '11 дней');
  assert.equal(pluralizeRussianDays(21), '21 день');
  assert.equal(pluralizeRussianDays(24), '24 дня');
});

test('review timing distinguishes due today, overdue and upcoming', () => {
  assert.equal(getReviewTimingLabel('due', 0), 'Пора повторить сегодня');
  assert.equal(getReviewTimingLabel('due', 3), 'Просрочено на 3 дня');
  assert.equal(getReviewTimingLabel('upcoming', 0), 'Скоро понадобится повторение');
});

test('skill and evidence states have learner-friendly Russian labels', () => {
  assert.equal(getSkillStatusLabel('mastered'), 'Освоен');
  assert.equal(getSkillStatusLabel('not_started'), 'Не начат');
  assert.equal(getEvidenceTypeLabel('delayed_check'), 'Отложенная проверка');
  assert.equal(getEvidenceTypeLabel('transfer'), 'Перенос навыка');
});
