import { BadRequestException } from '@nestjs/common';
import { asJsonRecord, asOptionList } from './json.js';

export interface PuzzleValidationResult {
  isCorrect: boolean;
  feedback: string;
}

export interface PuzzleAnswerReview {
  explanation: string;
  correctAnswer: Record<string, unknown>;
}

function invalidAnswer(message: string): never {
  throw new BadRequestException(message);
}

function invalidConfiguration(message: string): never {
  throw new Error('Published puzzle has an invalid private solution configuration: ' + message);
}

function stringArray(value: unknown, fieldName: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || item.length === 0) ||
    new Set(value).size !== value.length
  ) {
    invalidConfiguration(fieldName + ' must be a non-empty array of unique strings.');
  }

  return value as string[];
}

function answerStringArray(value: unknown, fieldName: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 50 ||
    value.some((item) => typeof item !== 'string' || item.length === 0) ||
    new Set(value).size !== value.length
  ) {
    invalidAnswer(fieldName + ' must contain unique item IDs.');
  }

  return value as string[];
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е');
}

function parseNumericAnswer(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value !== 'string' || value.length > 64) {
    return invalidAnswer('answer.value must be a finite number.');
  }

  const normalized = value.trim().replace(',', '.');
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return invalidAnswer('Enter a valid number using a decimal point if needed.');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return invalidAnswer('answer.value must be a finite number.');
  }

  return parsed;
}

function setEquals(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

/**
 * Creates the safe review payload shown only after the learner has used every
 * allowed attempt. The regular public quest/run serializers must never call it.
 */
export function buildPuzzleReview(
  type: string,
  publicPayload: unknown,
  solutionPrivate: unknown,
): PuzzleAnswerReview {
  const publicData = asJsonRecord(publicPayload);
  const solution = asJsonRecord(solutionPrivate);
  const options = asOptionList(publicData.options);
  const items = asOptionList(publicData.items);
  const explanation = solution.correctFeedback;

  if (typeof explanation !== 'string' || explanation.trim().length === 0) {
    invalidConfiguration('correctFeedback is required for puzzle review.');
  }

  let correctAnswer: Record<string, unknown>;
  switch (type) {
    case 'single_choice': {
      const optionId = solution.correctOptionId;
      if (typeof optionId !== 'string' || !options.some((option) => option.id === optionId)) {
        invalidConfiguration('correctOptionId must match a public option.');
      }
      correctAnswer = { optionId };
      break;
    }
    case 'multiple_choice': {
      const optionIds = stringArray(solution.correctOptionIds, 'correctOptionIds');
      const publicIds = new Set(options.map((option) => option.id));
      if (optionIds.some((id) => !publicIds.has(id))) {
        invalidConfiguration('correctOptionIds must match public options.');
      }
      correctAnswer = { optionIds };
      break;
    }
    case 'numeric_input': {
      const value = solution.correctValue;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        invalidConfiguration('correctValue must be a finite number.');
      }
      correctAnswer = { value };
      break;
    }
    case 'text_input': {
      correctAnswer = { acceptedAnswers: stringArray(solution.acceptedAnswers, 'acceptedAnswers') };
      break;
    }
    case 'ordering': {
      const orderedIds = stringArray(solution.correctOrderIds, 'correctOrderIds');
      const itemIds = items.map((item) => item.id);
      if (itemIds.length < 2 || orderedIds.length !== itemIds.length || !setEquals(orderedIds, itemIds)) {
        invalidConfiguration('correctOrderIds must contain every public item exactly once.');
      }
      correctAnswer = { orderedIds };
      break;
    }
    default:
      invalidConfiguration('puzzle type is not supported for review.');
  }

  return { explanation, correctAnswer };
}

export function validatePuzzleAnswer(
  type: string,
  publicPayload: unknown,
  solutionPrivate: unknown,
  answer: Record<string, unknown>,
): PuzzleValidationResult {
  const publicData = asJsonRecord(publicPayload);
  const solution = asJsonRecord(solutionPrivate);
  const options = asOptionList(publicData.options);
  const items = asOptionList(publicData.items);
  let isCorrect: boolean;

  switch (type) {
    case 'single_choice': {
      const optionId = answer.optionId;
      if (typeof optionId !== 'string' || !options.some((option) => option.id === optionId)) {
        invalidAnswer('Select one of the available options.');
      }
      if (typeof solution.correctOptionId !== 'string' ||
          !options.some((option) => option.id === solution.correctOptionId)) {
        invalidConfiguration('correctOptionId must match a public option.');
      }
      isCorrect = optionId === solution.correctOptionId;
      break;
    }

    case 'multiple_choice': {
      const optionIds = answerStringArray(answer.optionIds, 'answer.optionIds');
      const optionIdSet = new Set(options.map((option) => option.id));
      if (optionIds.some((id) => !optionIdSet.has(id))) {
        invalidAnswer('Select only the available options.');
      }
      const correctOptionIds = stringArray(solution.correctOptionIds, 'correctOptionIds');
      if (correctOptionIds.some((id) => !optionIdSet.has(id))) {
        invalidConfiguration('correctOptionIds must match public options.');
      }
      isCorrect = setEquals(optionIds, correctOptionIds);
      break;
    }

    case 'numeric_input': {
      const submittedValue = parseNumericAnswer(answer.value);
      const correctValue = solution.correctValue;
      const tolerance = solution.tolerance === undefined ? 0 : solution.tolerance;
      if (typeof correctValue !== 'number' || !Number.isFinite(correctValue)) {
        invalidConfiguration('correctValue must be a finite number.');
      }
      if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0) {
        invalidConfiguration('tolerance must be a non-negative finite number.');
      }
      isCorrect = Math.abs(submittedValue - correctValue) <= tolerance + Number.EPSILON;
      break;
    }

    case 'text_input': {
      const submittedText = answer.text;
      if (typeof submittedText !== 'string' || submittedText.trim().length === 0 ||
          submittedText.length > 2000) {
        invalidAnswer('answer.text must contain between 1 and 2000 characters.');
      }
      const acceptedAnswers = stringArray(solution.acceptedAnswers, 'acceptedAnswers');
      isCorrect = acceptedAnswers.some(
        (candidate) => normalizeText(candidate) === normalizeText(submittedText),
      );
      break;
    }

    case 'ordering': {
      const orderedIds = answerStringArray(answer.orderedIds, 'answer.orderedIds');
      const itemIds = items.map((item) => item.id);
      if (itemIds.length < 2 || orderedIds.length !== itemIds.length ||
          !setEquals(orderedIds, itemIds)) {
        invalidAnswer('Arrange all available items exactly once.');
      }
      const correctOrderIds = stringArray(solution.correctOrderIds, 'correctOrderIds');
      if (correctOrderIds.length !== itemIds.length || !setEquals(correctOrderIds, itemIds)) {
        invalidConfiguration('correctOrderIds must contain every public item exactly once.');
      }
      isCorrect = orderedIds.every((id, index) => id === correctOrderIds[index]);
      break;
    }

    default:
      invalidAnswer('This puzzle type is not supported by the current engine.');
  }

  return {
    isCorrect,
    feedback: isCorrect
      ? (typeof solution.correctFeedback === 'string' ? solution.correctFeedback : 'Верно!')
      : (typeof solution.incorrectFeedback === 'string'
        ? solution.incorrectFeedback
        : 'Пока не получилось. Попробуй ещё раз.'),
  };
}
