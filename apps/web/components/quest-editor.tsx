'use client';

import { useState, type FormEvent } from 'react';

export type CmsSkillOption = { id: string; key: string; name: string };
export type CmsCategoryOption = { id: string; title: string; status: string };

type ChoiceOption = { id: string; label: string };
type PuzzleDraft = {
  orderNo: number;
  type: string;
  maxAttempts: number;
  maxScore: number;
  publicPayload: Record<string, unknown>;
  solutionPrivate: Record<string, unknown>;
  hints: string[];
};
type LevelDraft = {
  orderNo: number;
  title: string;
  intro: string;
  puzzles: PuzzleDraft[];
};
export type QuestEditorPayload = {
  categoryId: string;
  slug?: string;
  locale: string;
  internalName?: string;
  title: string;
  summary: string;
  description: string;
  objectives: string[];
  skills: string[];
  ageMin: number;
  ageMax: number;
  difficulty: string;
  durationMin: number;
  seo: { title: string; description: string };
  coverUrl: string;
  coverAlt: string;
  coverLicenseSource: string;
  levels: LevelDraft[];
};

type SourcePuzzle = {
  orderNo: number;
  type: string;
  maxAttempts: number;
  maxScore: number;
  publicPayload: unknown;
  solutionPrivate?: unknown;
  hints: Array<{ body: string }>;
};
type SourceLevel = {
  orderNo: number;
  title: string;
  intro: string;
  puzzles: SourcePuzzle[];
};
type SourceVersion = {
  versionNo: number;
  status: string;
  locale: string;
  internalName: string | null;
  title: string;
  summary: string;
  description: string;
  objectives: unknown;
  skills: string[];
  ageMin: number;
  ageMax: number;
  difficulty: string;
  durationMin: number;
  seo: unknown;
  coverUrl: string | null;
  coverAlt: string | null;
  coverLicenseSource: string | null;
  reviewFeedback?: string | null;
  levels: SourceLevel[];
};
export type CmsQuestDetail = {
  id: string;
  slug: string;
  status: string;
  categoryId: string;
  versions: SourceVersion[];
};

type QuestForm = {
  categoryId: string;
  slug: string;
  locale: string;
  internalName: string;
  title: string;
  summary: string;
  description: string;
  objectivesText: string;
  ageMin: string;
  ageMax: string;
  difficulty: string;
  durationMin: string;
  seoTitle: string;
  seoDescription: string;
  coverUrl: string;
  coverAlt: string;
  coverLicenseSource: string;
  skills: string[];
};

type Props = {
  categories: CmsCategoryOption[];
  skills: CmsSkillOption[];
  initialQuest?: CmsQuestDetail;
  readOnly?: boolean;
  lockSlug?: boolean;
  saving?: boolean;
  onSave?: (payload: QuestEditorPayload) => Promise<boolean>;
  onCancel: () => void;
};

const PUZZLE_TYPES = [
  { value: 'single_choice', label: 'Один вариант ответа' },
  { value: 'multiple_choice', label: 'Несколько вариантов' },
  { value: 'numeric_input', label: 'Числовой ответ' },
  { value: 'text_input', label: 'Текстовый ответ' },
  { value: 'ordering', label: 'Правильная последовательность' },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asRows(value: unknown): ChoiceOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    return typeof item.id === 'string' && typeof item.label === 'string'
      ? [{ id: item.id, label: item.label }]
      : [];
  });
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function newPuzzle(type = 'single_choice', orderNo = 1): PuzzleDraft {
  let publicPayload: Record<string, unknown>;
  let solutionPrivate: Record<string, unknown>;

  if (type === 'numeric_input') {
    publicPayload = { prompt: '', unit: '' };
    solutionPrivate = { correctValue: 0, tolerance: 0 };
  } else if (type === 'text_input') {
    publicPayload = { prompt: '' };
    solutionPrivate = { acceptedAnswers: [''] };
  } else if (type === 'ordering') {
    publicPayload = {
      prompt: '',
      items: [{ id: 'item-1', label: '' }, { id: 'item-2', label: '' }],
    };
    solutionPrivate = { correctOrderIds: ['item-1', 'item-2'] };
  } else {
    publicPayload = {
      prompt: '',
      options: [{ id: 'option-1', label: '' }, { id: 'option-2', label: '' }],
    };
    solutionPrivate = type === 'multiple_choice'
      ? { correctOptionIds: ['option-1'] }
      : { correctOptionId: 'option-1' };
  }

  return {
    orderNo,
    type,
    maxAttempts: 3,
    maxScore: 10,
    publicPayload,
    solutionPrivate: {
      ...solutionPrivate,
      correctFeedback: '',
      incorrectFeedback: '',
    },
    hints: [''],
  };
}

function newLevel(orderNo = 1): LevelDraft {
  return {
    orderNo,
    title: 'Новый уровень',
    intro: '',
    puzzles: [newPuzzle('single_choice', 1)],
  };
}

function emptyForm(): QuestForm {
  return {
    categoryId: '',
    slug: '',
    locale: 'ru',
    internalName: '',
    title: '',
    summary: '',
    description: '',
    objectivesText: '',
    ageMin: '14',
    ageMax: '99',
    difficulty: 'beginner',
    durationMin: '10',
    seoTitle: '',
    seoDescription: '',
    coverUrl: '',
    coverAlt: '',
    coverLicenseSource: '',
    skills: [],
  };
}

function fromQuest(quest: CmsQuestDetail): { form: QuestForm; levels: LevelDraft[] } {
  const version = quest.versions[0];
  if (!version) return { form: { ...emptyForm(), slug: quest.slug, categoryId: quest.categoryId }, levels: [newLevel()] };
  const seo = asRecord(version.seo);
  const objectives = asStringArray(version.objectives);
  const levels = version.levels.map((level) => ({
    orderNo: level.orderNo,
    title: level.title,
    intro: level.intro,
    puzzles: level.puzzles.map((puzzle) => ({
      orderNo: puzzle.orderNo,
      type: puzzle.type,
      maxAttempts: puzzle.maxAttempts,
      maxScore: puzzle.maxScore,
      publicPayload: asRecord(puzzle.publicPayload),
      solutionPrivate: asRecord(puzzle.solutionPrivate),
      hints: puzzle.hints.map((hint) => hint.body),
    })),
  }));

  return {
    form: {
      categoryId: quest.categoryId,
      slug: quest.slug,
      locale: version.locale || 'ru',
      internalName: version.internalName ?? '',
      title: version.title,
      summary: version.summary,
      description: version.description,
      objectivesText: objectives.join('\n'),
      ageMin: String(version.ageMin),
      ageMax: String(version.ageMax),
      difficulty: version.difficulty,
      durationMin: String(version.durationMin),
      seoTitle: typeof seo.title === 'string' ? seo.title : '',
      seoDescription: typeof seo.description === 'string' ? seo.description : '',
      coverUrl: version.coverUrl ?? '',
      coverAlt: version.coverAlt ?? '',
      coverLicenseSource: version.coverLicenseSource ?? '',
      skills: [...version.skills],
    },
    levels: levels.length ? levels : [newLevel()],
  };
}

function moveItem<T>(items: T[], from: number, direction: -1 | 1): T[] {
  const to = from + direction;
  if (to < 0 || to >= items.length) return items;
  const copy = [...items];
  [copy[from], copy[to]] = [copy[to]!, copy[from]!];
  return copy;
}

function uniqueId(prefix: string, current: ChoiceOption[]): string {
  let index = current.length + 1;
  while (current.some((item) => item.id === prefix + '-' + index)) index += 1;
  return prefix + '-' + index;
}

function answerSummary(puzzle: PuzzleDraft): string {
  const solution = puzzle.solutionPrivate;
  if (puzzle.type === 'single_choice' || puzzle.type === 'multiple_choice') {
    const ids = puzzle.type === 'single_choice'
      ? [String(solution.correctOptionId ?? '')]
      : asStringArray(solution.correctOptionIds);
    return ids.map((id) => asRows(puzzle.publicPayload.options).find((option) => option.id === id)?.label ?? id)
      .filter(Boolean).join(', ');
  }
  if (puzzle.type === 'numeric_input') {
    const unit = typeof puzzle.publicPayload.unit === 'string' ? puzzle.publicPayload.unit : '';
    return String(solution.correctValue ?? '') + (unit ? ' ' + unit : '');
  }
  if (puzzle.type === 'text_input') return asStringArray(solution.acceptedAnswers).join(' / ');
  if (puzzle.type === 'ordering') {
    const items = asRows(puzzle.publicPayload.items);
    return asStringArray(solution.correctOrderIds)
      .map((id) => items.find((item) => item.id === id)?.label ?? id).join(' → ');
  }
  return 'Неизвестный тип задания';
}

export function QuestEditor({
  categories,
  skills,
  initialQuest,
  readOnly = false,
  lockSlug = false,
  saving = false,
  onSave,
  onCancel,
}: Props) {
  const initial = initialQuest ? fromQuest(initialQuest) : { form: emptyForm(), levels: [newLevel()] };
  const [form, setForm] = useState<QuestForm>(initial.form);
  const [levels, setLevels] = useState<LevelDraft[]>(initial.levels);
  const [localError, setLocalError] = useState('');

  function setField<K extends keyof QuestForm>(key: K, value: QuestForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateLevel(levelIndex: number, patch: Partial<LevelDraft>) {
    setLevels((current) => current.map((level, index) => index === levelIndex ? { ...level, ...patch } : level));
  }

  function updatePuzzle(levelIndex: number, puzzleIndex: number, patch: Partial<PuzzleDraft>) {
    setLevels((current) => current.map((level, index) => index !== levelIndex ? level : {
      ...level,
      puzzles: level.puzzles.map((puzzle, itemIndex) => itemIndex === puzzleIndex
        ? { ...puzzle, ...patch }
        : puzzle),
    }));
  }

  function updatePublic(levelIndex: number, puzzleIndex: number, patch: Record<string, unknown>) {
    const puzzle = levels[levelIndex]?.puzzles[puzzleIndex];
    if (!puzzle) return;
    updatePuzzle(levelIndex, puzzleIndex, { publicPayload: { ...puzzle.publicPayload, ...patch } });
  }

  function updateSolution(levelIndex: number, puzzleIndex: number, patch: Record<string, unknown>) {
    const puzzle = levels[levelIndex]?.puzzles[puzzleIndex];
    if (!puzzle) return;
    updatePuzzle(levelIndex, puzzleIndex, { solutionPrivate: { ...puzzle.solutionPrivate, ...patch } });
  }

  function changePuzzleType(levelIndex: number, puzzleIndex: number, type: string) {
    const current = levels[levelIndex]?.puzzles[puzzleIndex];
    if (!current) return;
    const replacement = newPuzzle(type, current.orderNo);
    replacement.publicPayload.prompt = typeof current.publicPayload.prompt === 'string' ? current.publicPayload.prompt : '';
    replacement.hints = current.hints.length ? current.hints : [''];
    replacement.maxAttempts = current.maxAttempts;
    replacement.maxScore = current.maxScore;
    replacement.solutionPrivate.correctFeedback = current.solutionPrivate.correctFeedback ?? '';
    replacement.solutionPrivate.incorrectFeedback = current.solutionPrivate.incorrectFeedback ?? '';
    updatePuzzle(levelIndex, puzzleIndex, replacement);
  }

  function validate(): string[] {
    const errors: string[] = [];
    const objectives = form.objectivesText.split('\n').map((value) => value.trim()).filter(Boolean);
    if (objectives.length < 2 || objectives.length > 4) errors.push('Укажи от 2 до 4 учебных целей.');
    if (!form.skills.length) errors.push('Выбери хотя бы один навык из каталога.');
    if (levels.length < 1) errors.push('Добавь хотя бы один уровень.');

    levels.forEach((level, levelIndex) => {
      if (!level.title.trim() || !level.intro.trim()) errors.push('Уровень ' + (levelIndex + 1) + ': заполни название и описание.');
      if (!level.puzzles.length) errors.push('Уровень ' + (levelIndex + 1) + ': добавь хотя бы одно задание.');
      level.puzzles.forEach((puzzle, puzzleIndex) => {
        const number = 'Задание ' + (levelIndex + 1) + '.' + (puzzleIndex + 1) + ': ';
        if (!puzzle.hints.some((hint) => hint.trim())) errors.push(number + 'добавь хотя бы одну подсказку.');
        if (typeof puzzle.solutionPrivate.correctFeedback !== 'string' || puzzle.solutionPrivate.correctFeedback.trim().length < 5) {
          errors.push(number + 'добавь объяснение правильного ответа (от 5 символов).');
        }
        if (puzzle.type === 'single_choice' || puzzle.type === 'multiple_choice') {
          const options = asRows(puzzle.publicPayload.options);
          const ids = options.map((option) => option.id.trim());
          if (options.length < 2 || options.some((option) => !option.id.trim() || !option.label.trim()) || new Set(ids).size !== ids.length) {
            errors.push(number + 'добавь минимум два варианта с уникальными ID и непустыми подписями.');
          }
          const correct = puzzle.type === 'single_choice'
            ? [String(puzzle.solutionPrivate.correctOptionId ?? '')]
            : asStringArray(puzzle.solutionPrivate.correctOptionIds);
          if (!correct.length || correct.some((id) => !ids.includes(id))) errors.push(number + 'отметь правильный вариант ответа.');
        } else if (puzzle.type === 'numeric_input') {
          if (typeof puzzle.solutionPrivate.correctValue !== 'number' || !Number.isFinite(puzzle.solutionPrivate.correctValue)) {
            errors.push(number + 'укажи правильное числовое значение.');
          }
        } else if (puzzle.type === 'text_input') {
          if (!asStringArray(puzzle.solutionPrivate.acceptedAnswers).some((value) => value.trim())) {
            errors.push(number + 'добавь хотя бы один допустимый ответ.');
          }
        } else if (puzzle.type === 'ordering') {
          const items = asRows(puzzle.publicPayload.items);
          const ids = items.map((item) => item.id.trim());
          const correct = asStringArray(puzzle.solutionPrivate.correctOrderIds);
          if (items.length < 2 || items.some((item) => !item.id.trim() || !item.label.trim()) ||
              new Set(ids).size !== ids.length || correct.length !== ids.length ||
              new Set(correct).size !== correct.length || correct.some((id) => !ids.includes(id))) {
            errors.push(number + 'заполни элементы и проверь правильный порядок.');
          }
        } else {
          errors.push(number + 'выбран неподдерживаемый тип.');
        }
      });
    });
    return errors;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError('');
    const errors = validate();
    if (errors.length) {
      setLocalError(errors.slice(0, 5).join(' '));
      return;
    }
    if (!onSave) return;

    const payload: QuestEditorPayload = {
      categoryId: form.categoryId,
      ...(!lockSlug ? { slug: form.slug.trim() } : {}),
      locale: form.locale,
      ...(form.internalName.trim() ? { internalName: form.internalName.trim() } : {}),
      title: form.title.trim(),
      summary: form.summary.trim(),
      description: form.description.trim(),
      objectives: form.objectivesText.split('\n').map((value) => value.trim()).filter(Boolean),
      skills: form.skills,
      ageMin: Number(form.ageMin),
      ageMax: Number(form.ageMax),
      difficulty: form.difficulty,
      durationMin: Number(form.durationMin),
      seo: { title: form.seoTitle.trim(), description: form.seoDescription.trim() },
      coverUrl: form.coverUrl.trim(),
      coverAlt: form.coverAlt.trim(),
      coverLicenseSource: form.coverLicenseSource.trim(),
      levels: levels.map((level, levelIndex) => ({
        ...level,
        orderNo: levelIndex + 1,
        puzzles: level.puzzles.map((puzzle, puzzleIndex) => ({
          ...puzzle,
          orderNo: puzzleIndex + 1,
          hints: puzzle.hints.map((hint) => hint.trim()).filter(Boolean),
        })),
      })),
    };

    if (payload.ageMin > payload.ageMax) {
      setLocalError('Минимальный возраст не может быть больше максимального.');
      return;
    }
    await onSave(payload);
  }

  const disabled = readOnly || saving;

  return (
    <div className="admin-editor">
      {readOnly && <p className="admin-review-banner">Режим проверки: данные версии доступны только для чтения. Публикация остаётся отдельным действием администратора.</p>}
      {initialQuest?.versions[0]?.reviewFeedback && <aside className="admin-review-feedback" role="status">
        <strong>Замечания рецензента</strong>
        <p>{initialQuest.versions[0].reviewFeedback}</p>
        <small>Исправь пункты и отправь черновик на повторную проверку.</small>
      </aside>}
      <form className="admin-form admin-form-grid" onSubmit={submit}>
        <label className="field admin-field-wide">
          <span>Рубрика</span>
          <select disabled={disabled} value={form.categoryId} onChange={(event) => setField('categoryId', event.target.value)} required>
            <option value="">Выбери опубликованную рубрику</option>
            {categories.filter((category) => category.status === 'PUBLISHED' || category.id === form.categoryId).map((category) => (
              <option value={category.id} key={category.id}>{category.title}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Slug</span>
          <input disabled={disabled || lockSlug} value={form.slug} onChange={(event) => setField('slug', event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required/>
          {lockSlug && <small>Публичный адрес зафиксирован после первой публикации.</small>}
        </label>
        <label className="field">
          <span>Название</span>
          <input disabled={disabled} value={form.title} onChange={(event) => setField('title', event.target.value)} minLength={5} maxLength={160} required/>
        </label>
        <label className="field admin-field-wide">
          <span>Краткое описание</span>
          <textarea disabled={disabled} rows={2} value={form.summary} onChange={(event) => setField('summary', event.target.value)} minLength={20} maxLength={500} required/>
        </label>
        <label className="field admin-field-wide">
          <span>Полное описание</span>
          <textarea disabled={disabled} rows={4} value={form.description} onChange={(event) => setField('description', event.target.value)} minLength={50} maxLength={12000} required/>
        </label>
        <label className="field">
          <span>Внутреннее название (не показывается игроку)</span>
          <input disabled={disabled} value={form.internalName} onChange={(event) => setField('internalName', event.target.value)} maxLength={140}/>
        </label>
        <label className="field">
          <span>Язык</span>
          <select disabled={disabled} value={form.locale} onChange={(event) => setField('locale', event.target.value)}>
            <option value="ru">Русский</option><option value="de">Deutsch</option><option value="en">English</option>
          </select>
        </label>
        <label className="field">
          <span>Учебные цели (2–4, каждая с новой строки)</span>
          <textarea disabled={disabled} rows={3} value={form.objectivesText} onChange={(event) => setField('objectivesText', event.target.value)} required/>
        </label>
        <fieldset className="admin-skill-picker">
          <legend>Навыки из каталога (минимум один)</legend>
          {skills.map((skill) => (
            <label className="admin-skill-option" key={skill.id}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={form.skills.includes(skill.name)}
                onChange={(event) => setField('skills', event.target.checked
                  ? [...form.skills, skill.name]
                  : form.skills.filter((name) => name !== skill.name))}
              />
              <span>{skill.name}</span>
            </label>
          ))}
          {!skills.length && <span className="admin-editor-help">Каталог навыков пока пуст.</span>}
        </fieldset>
        <label className="field">
          <span>Возраст от</span>
          <input disabled={disabled} type="number" min="14" max="99" value={form.ageMin} onChange={(event) => setField('ageMin', event.target.value)} required/>
        </label>
        <label className="field">
          <span>Возраст до</span>
          <input disabled={disabled} type="number" min="14" max="99" value={form.ageMax} onChange={(event) => setField('ageMax', event.target.value)} required/>
        </label>
        <label className="field">
          <span>Сложность</span>
          <select disabled={disabled} value={form.difficulty} onChange={(event) => setField('difficulty', event.target.value)}>
            <option value="beginner">Начальная</option><option value="intermediate">Средняя</option><option value="advanced">Продвинутая</option>
          </select>
        </label>
        <label className="field">
          <span>Длительность (мин)</span>
          <input disabled={disabled} type="number" min="1" max="240" value={form.durationMin} onChange={(event) => setField('durationMin', event.target.value)} required/>
        </label>
        <label className="field">
          <span>SEO title</span>
          <input disabled={disabled} value={form.seoTitle} onChange={(event) => setField('seoTitle', event.target.value)} minLength={5} required/>
        </label>
        <label className="field">
          <span>SEO description</span>
          <input disabled={disabled} value={form.seoDescription} onChange={(event) => setField('seoDescription', event.target.value)} minLength={20} required/>
        </label>
        <label className="field">
          <span>URL обложки или путь /media/</span>
          <input disabled={disabled} value={form.coverUrl} onChange={(event) => setField('coverUrl', event.target.value)} required/>
        </label>
        <label className="field">
          <span>Alt-текст обложки</span>
          <input disabled={disabled} value={form.coverAlt} onChange={(event) => setField('coverAlt', event.target.value)} minLength={5} required/>
        </label>
        <label className="field admin-field-wide">
          <span>Источник лицензии обложки</span>
          <input disabled={disabled} value={form.coverLicenseSource} onChange={(event) => setField('coverLicenseSource', event.target.value)} minLength={5} required/>
        </label>

        <div className="admin-level-editor admin-field-wide">
          <div className="admin-editor-heading">
            <div><h3>Уровни и задания</h3><p>Добавляй задания и выбирай тип. Правильные ответы и подсказки хранятся отдельно от публичного условия.</p></div>
            {!readOnly && <button className="button button-small button-secondary" type="button" onClick={() => setLevels((current) => [...current, newLevel(current.length + 1)])}>Добавить уровень</button>}
          </div>
          {levels.map((level, levelIndex) => (
            <section className="admin-level-card" key={'level-' + levelIndex}>
              <div className="admin-editor-heading">
                <h4>Уровень {levelIndex + 1}</h4>
                {!readOnly && <div className="admin-row-actions">
                  <button className="button button-small button-secondary" type="button" disabled={levelIndex === 0} onClick={() => setLevels((current) => moveItem(current, levelIndex, -1))} aria-label="Переместить уровень выше">↑</button>
                  <button className="button button-small button-secondary" type="button" disabled={levelIndex === levels.length - 1} onClick={() => setLevels((current) => moveItem(current, levelIndex, 1))} aria-label="Переместить уровень ниже">↓</button>
                  <button className="button button-small button-danger" type="button" disabled={levels.length <= 1} onClick={() => setLevels((current) => current.filter((_, index) => index !== levelIndex))}>Удалить</button>
                </div>}
              </div>
              <label className="field"><span>Название уровня</span><input disabled={disabled} value={level.title} onChange={(event) => updateLevel(levelIndex, { title: event.target.value })} required/></label>
              <label className="field"><span>Сюжет и инструкция</span><textarea disabled={disabled} rows={3} value={level.intro} onChange={(event) => updateLevel(levelIndex, { intro: event.target.value })} minLength={5} required/></label>

              <div className="admin-puzzle-list">
                {level.puzzles.map((puzzle, puzzleIndex) => {
                  const options = asRows(puzzle.publicPayload.options);
                  const items = asRows(puzzle.publicPayload.items);
                  const correctIds = asStringArray(puzzle.solutionPrivate.correctOptionIds);
                  const correctOrder = asStringArray(puzzle.solutionPrivate.correctOrderIds);
                  return (
                    <article className="admin-puzzle-card" key={'puzzle-' + levelIndex + '-' + puzzleIndex}>
                      <div className="admin-editor-heading">
                        <h5>Задание {levelIndex + 1}.{puzzleIndex + 1}</h5>
                        {!readOnly && <div className="admin-row-actions">
                          <button className="button button-small button-secondary" type="button" disabled={puzzleIndex === 0} onClick={() => updateLevel(levelIndex, { puzzles: moveItem(level.puzzles, puzzleIndex, -1) })} aria-label="Переместить задание выше">↑</button>
                          <button className="button button-small button-secondary" type="button" disabled={puzzleIndex === level.puzzles.length - 1} onClick={() => updateLevel(levelIndex, { puzzles: moveItem(level.puzzles, puzzleIndex, 1) })} aria-label="Переместить задание ниже">↓</button>
                          <button className="button button-small button-danger" type="button" disabled={level.puzzles.length <= 1} onClick={() => updateLevel(levelIndex, { puzzles: level.puzzles.filter((_, index) => index !== puzzleIndex) })}>Удалить</button>
                        </div>}
                      </div>
                      <label className="field">
                        <span>Тип задания</span>
                        <select disabled={disabled} value={puzzle.type} onChange={(event) => changePuzzleType(levelIndex, puzzleIndex, event.target.value)}>
                          {PUZZLE_TYPES.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}
                        </select>
                      </label>
                      <label className="field">
                        <span>Текст задания</span>
                        <textarea disabled={disabled} rows={2} value={typeof puzzle.publicPayload.prompt === 'string' ? puzzle.publicPayload.prompt : ''} onChange={(event) => updatePublic(levelIndex, puzzleIndex, { prompt: event.target.value })} required/>
                      </label>
                      {(puzzle.type === 'single_choice' || puzzle.type === 'multiple_choice') && (
                        <div className="admin-puzzle-options">
                          <strong>Варианты ответа</strong>
                          {options.map((option, optionIndex) => (
                            <div className="admin-option-row" key={option.id + '-' + optionIndex}>
                              <label className="field"><span>ID варианта</span><input disabled={disabled} value={option.id} onChange={(event) => {
                                const next = options.map((item, index) => index === optionIndex ? { ...item, id: event.target.value } : item);
                                updatePublic(levelIndex, puzzleIndex, { options: next });
                                if (puzzle.solutionPrivate.correctOptionId === option.id) updateSolution(levelIndex, puzzleIndex, { correctOptionId: event.target.value });
                                updateSolution(levelIndex, puzzleIndex, { correctOptionIds: correctIds.map((id) => id === option.id ? event.target.value : id) });
                              }}/></label>
                              <label className="field"><span>Подпись</span><input disabled={disabled} value={option.label} onChange={(event) => updatePublic(levelIndex, puzzleIndex, { options: options.map((item, index) => index === optionIndex ? { ...item, label: event.target.value } : item) })}/></label>
                              {!readOnly && <button className="button button-small button-danger" type="button" disabled={options.length <= 2} onClick={() => {
                                const next = options.filter((_, index) => index !== optionIndex);
                                updatePublic(levelIndex, puzzleIndex, { options: next });
                                updateSolution(levelIndex, puzzleIndex, {
                                  ...(puzzle.solutionPrivate.correctOptionId === option.id
                                    ? { correctOptionId: next[0]?.id ?? '' }
                                    : {}),
                                  correctOptionIds: correctIds.filter((id) => id !== option.id),
                                });
                              }}>Убрать</button>}
                            </div>
                          ))}
                          {!readOnly && <button className="button button-small button-secondary" type="button" onClick={() => updatePublic(levelIndex, puzzleIndex, { options: [...options, { id: uniqueId('option', options), label: '' }] })}>Добавить вариант</button>}
                          {puzzle.type === 'single_choice' ? (
                            <label className="field"><span>Правильный вариант</span>
                              <select disabled={disabled} value={String(puzzle.solutionPrivate.correctOptionId ?? '')} onChange={(event) => updateSolution(levelIndex, puzzleIndex, { correctOptionId: event.target.value })}>
                                {options.map((option) => <option key={option.id} value={option.id}>{option.label || option.id}</option>)}
                              </select>
                            </label>
                          ) : (
                            <fieldset className="admin-answer-picker">
                              <legend>Правильные варианты (можно несколько)</legend>
                              {options.map((option) => <label key={option.id}><input type="checkbox" disabled={disabled} checked={correctIds.includes(option.id)} onChange={(event) => updateSolution(levelIndex, puzzleIndex, { correctOptionIds: event.target.checked ? [...correctIds, option.id] : correctIds.filter((id) => id !== option.id) })}/><span>{option.label || option.id}</span></label>)}
                            </fieldset>
                          )}
                        </div>
                      )}
                      {puzzle.type === 'numeric_input' && (
                        <>
                          <label className="field"><span>Единица измерения (необязательно)</span><input disabled={disabled} value={typeof puzzle.publicPayload.unit === 'string' ? puzzle.publicPayload.unit : ''} onChange={(event) => updatePublic(levelIndex, puzzleIndex, { unit: event.target.value })}/></label>
                          <label className="field"><span>Правильное число</span><input disabled={disabled} type="number" step="any" value={typeof puzzle.solutionPrivate.correctValue === 'number' ? puzzle.solutionPrivate.correctValue : ''} onChange={(event) => updateSolution(levelIndex, puzzleIndex, { correctValue: event.target.value === '' ? '' : Number(event.target.value) })} required/></label>
                          <label className="field"><span>Допуск (необязательно)</span><input disabled={disabled} type="number" min="0" step="any" value={typeof puzzle.solutionPrivate.tolerance === 'number' ? puzzle.solutionPrivate.tolerance : 0} onChange={(event) => updateSolution(levelIndex, puzzleIndex, { tolerance: event.target.value === '' ? 0 : Number(event.target.value) })}/></label>
                        </>
                      )}
                      {puzzle.type === 'text_input' && (
                        <label className="field"><span>Допустимые ответы (каждый с новой строки)</span><textarea disabled={disabled} rows={3} value={asStringArray(puzzle.solutionPrivate.acceptedAnswers).join('\n')} onChange={(event) => updateSolution(levelIndex, puzzleIndex, { acceptedAnswers: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) })} required/></label>
                      )}
                      {puzzle.type === 'ordering' && (
                        <div className="admin-puzzle-options">
                          <strong>Элементы для сортировки</strong>
                          {items.map((item, itemIndex) => (
                            <div className="admin-option-row" key={item.id + '-' + itemIndex}>
                              <label className="field"><span>ID элемента</span><input disabled={disabled} value={item.id} onChange={(event) => {
                                const nextId = event.target.value;
                                updatePublic(levelIndex, puzzleIndex, { items: items.map((entry, index) => index === itemIndex ? { ...entry, id: nextId } : entry) });
                                updateSolution(levelIndex, puzzleIndex, { correctOrderIds: correctOrder.map((id) => id === item.id ? nextId : id) });
                              }}/></label>
                              <label className="field"><span>Текст элемента</span><input disabled={disabled} value={item.label} onChange={(event) => updatePublic(levelIndex, puzzleIndex, { items: items.map((entry, index) => index === itemIndex ? { ...entry, label: event.target.value } : entry) })}/></label>
                              {!readOnly && <button className="button button-small button-danger" type="button" disabled={items.length <= 2} onClick={() => {
                                updatePublic(levelIndex, puzzleIndex, { items: items.filter((_, index) => index !== itemIndex) });
                                updateSolution(levelIndex, puzzleIndex, { correctOrderIds: correctOrder.filter((id) => id !== item.id) });
                              }}>Убрать</button>}
                            </div>
                          ))}
                          {!readOnly && <button className="button button-small button-secondary" type="button" onClick={() => {
                            const id = uniqueId('item', items);
                            updatePublic(levelIndex, puzzleIndex, { items: [...items, { id, label: '' }] });
                            updateSolution(levelIndex, puzzleIndex, { correctOrderIds: [...correctOrder, id] });
                          }}>Добавить элемент</button>}
                          <strong>Правильный порядок</strong>
                          {correctOrder.map((id, orderIndex) => {
                            const item = items.find((entry) => entry.id === id);
                            return <div className="admin-order-row" key={id + '-' + orderIndex}>
                              <span>{orderIndex + 1}. {item?.label || id}</span>
                              {!readOnly && <div className="admin-row-actions">
                                <button className="button button-small button-secondary" type="button" disabled={orderIndex === 0} onClick={() => updateSolution(levelIndex, puzzleIndex, { correctOrderIds: moveItem(correctOrder, orderIndex, -1) })} aria-label="Поднять элемент в ответе">↑</button>
                                <button className="button button-small button-secondary" type="button" disabled={orderIndex === correctOrder.length - 1} onClick={() => updateSolution(levelIndex, puzzleIndex, { correctOrderIds: moveItem(correctOrder, orderIndex, 1) })} aria-label="Опустить элемент в ответе">↓</button>
                              </div>}
                            </div>;
                          })}
                        </div>
                      )}
                      <div className="admin-form-grid">
                        <label className="field"><span>Число попыток</span><input disabled={disabled} type="number" min="1" max="10" value={puzzle.maxAttempts} onChange={(event) => updatePuzzle(levelIndex, puzzleIndex, { maxAttempts: Number(event.target.value) })}/></label>
                        <label className="field"><span>Максимальный балл</span><input disabled={disabled} type="number" min="1" max="100" value={puzzle.maxScore} onChange={(event) => updatePuzzle(levelIndex, puzzleIndex, { maxScore: Number(event.target.value) })}/></label>
                      </div>
                      <label className="field"><span>Подсказки (каждая с новой строки)</span><textarea disabled={disabled} rows={2} value={puzzle.hints.join('\n')} onChange={(event) => updatePuzzle(levelIndex, puzzleIndex, { hints: event.target.value.split('\n') })} required/></label>
                      <label className="field"><span>Объяснение правильного ответа</span><textarea disabled={disabled} rows={2} value={typeof puzzle.solutionPrivate.correctFeedback === 'string' ? puzzle.solutionPrivate.correctFeedback : ''} onChange={(event) => updateSolution(levelIndex, puzzleIndex, { correctFeedback: event.target.value })} minLength={5} required/></label>
                      <label className="field"><span>Обратная связь при ошибке</span><textarea disabled={disabled} rows={2} value={typeof puzzle.solutionPrivate.incorrectFeedback === 'string' ? puzzle.solutionPrivate.incorrectFeedback : ''} onChange={(event) => updateSolution(levelIndex, puzzleIndex, { incorrectFeedback: event.target.value })}/></label>
                      {readOnly && <div className="admin-review-answer"><strong>Правильный ответ</strong><p>{answerSummary(puzzle) || 'Не задан'}</p><small>{String(puzzle.solutionPrivate.correctFeedback ?? '')}</small></div>}
                    </article>
                  );
                })}
              </div>
              {!readOnly && <button className="button button-small button-secondary" type="button" onClick={() => updateLevel(levelIndex, { puzzles: [...level.puzzles, newPuzzle('single_choice', level.puzzles.length + 1)] })}>Добавить задание</button>}
            </section>
          ))}
        </div>

        {!readOnly && localError && <p className="form-error admin-field-wide" role="alert">{localError}</p>}
        <div className="admin-editor-actions admin-field-wide">
          <button className="button button-secondary" type="button" onClick={onCancel}>Закрыть</button>
          {!readOnly && <button className="button button-primary" disabled={disabled || !form.categoryId} type="submit">{saving ? 'Сохраняем…' : initialQuest ? 'Сохранить изменения' : 'Создать черновик'}</button>}
        </div>
      </form>

      <section className="admin-editor-preview">
        <div className="admin-editor-heading"><div><h3>Предпросмотр структуры</h3><p>Так редактор видит публичные условия заданий, без показа ответов игроку.</p></div></div>
        <h4>{form.title || 'Название квеста'}</h4>
        {levels.map((level, levelIndex) => (
          <article key={'preview-' + levelIndex}>
            <strong>{levelIndex + 1}. {level.title || 'Без названия'}</strong>
            <p>{level.intro}</p>
            {level.puzzles.map((puzzle, puzzleIndex) => (
              <div className="admin-preview-puzzle" key={'preview-puzzle-' + puzzleIndex}>
                <span>{puzzleIndex + 1}. {puzzle.publicPayload.prompt as string || 'Текст задания'}</span>
                {asRows(puzzle.publicPayload.options).map((option) => <small key={option.id}>{option.label}</small>)}
                {asRows(puzzle.publicPayload.items).map((item) => <small key={item.id}>{item.label}</small>)}
              </div>
            ))}
          </article>
        ))}
      </section>
    </div>
  );
}
