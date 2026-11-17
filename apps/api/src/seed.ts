import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed Questoria content.');
}

const pool = new Pool({ connectionString });

async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roles = [
      ['AUTHOR', 'Автор контента'],
      ['REVIEWER', 'Редактор-рецензент'],
      ['ADMIN', 'Администратор'],
      ['SUPER_ADMIN', 'Суперадминистратор'],
    ] as const;
    for (const [key, name] of roles) {
      await client.query(
        `INSERT INTO roles (id, key, name) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name`,
        [randomUUID(), key, name],
      );
    }

    const category = await client.query<{ id: string }>(
      `INSERT INTO categories (id, slug, locale, title, description, status, sort_order, updated_at)
       VALUES ($1, 'logic', 'ru', 'Логика и мышление',
         'Закономерности, дедукция и задачи на внимательность.', 'PUBLISHED', 1, NOW())
       ON CONFLICT (locale, slug) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description,
         status = 'PUBLISHED', updated_at = NOW()
       RETURNING id`,
      [randomUUID()],
    );

    const quest = await client.query<{ id: string }>(
      `INSERT INTO quests (id, category_id, slug, status, updated_at)
       VALUES ($1, $2, 'mystery-of-the-missing-number', 'DRAFT', NOW())
       ON CONFLICT (slug) DO UPDATE SET
         category_id = EXCLUDED.category_id, updated_at = NOW()
       RETURNING id`,
      [randomUUID(), category.rows[0].id],
    );

    const version = await client.query<{ id: string }>(
      `INSERT INTO quest_versions
       (id, quest_id, version_no, title, summary, objectives, age_min, age_max,
        difficulty, duration_min, locale, seo, status, published_at)
       VALUES ($1, $2, 2, 'Тайна пропавшего числа',
         'Пройди пять испытаний, чтобы раскрыть правило числового ряда и открыть шифрованную дверь.',
         $3::jsonb, 14, 99, 'Начальный', 12, 'ru',
         $4::jsonb, 'DRAFT', NULL)
       ON CONFLICT (quest_id, version_no) DO NOTHING
       RETURNING id`,
      [
        randomUUID(),
        quest.rows[0].id,
        JSON.stringify([
          'Находить числовые закономерности',
          'Различать факты и отвлекающие утверждения',
          'Применять правило к числовым и текстовым ответам',
          'Упорядочивать элементы последовательности',
        ]),
        JSON.stringify({
          title: 'Тайна пропавшего числа — логический квест',
          description: 'Пять разных форматов заданий помогут раскрыть правило последовательности.',
        }),
      ],
    );

    if (!version.rows[0]) {
      const existingVersion = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM quest_versions WHERE quest_id = $1 AND version_no = 2`,
        [quest.rows[0].id],
      );
      const current = existingVersion.rows[0];
      if (!current) throw new Error('Demo quest version could not be created.');
      if (current.status === 'PUBLISHED') {
        await client.query('COMMIT');
        process.stdout.write('Questoria demo quest version 2 is already published; seed skipped without mutating history.\\n');
        return;
      }
      if (current.status !== 'DRAFT') {
        throw new Error(`Demo quest version 2 is in ${current.status}; seed will not overwrite editorial workflow state.`);
      }
      version.rows.push({ id: current.id });
    }

    const level = await client.query<{ id: string }>(
      `INSERT INTO levels (id, quest_version_id, order_no, title, intro)
       VALUES ($1, $2, 1, 'Шифрованная дверь',
         'На двери мерцает последовательность: 2, 4, 8, 16. Пройди пять коротких испытаний, чтобы открыть замок.')
       ON CONFLICT (quest_version_id, order_no) DO UPDATE SET
         title = EXCLUDED.title, intro = EXCLUDED.intro
       RETURNING id`,
      [randomUUID(), version.rows[0].id],
    );

    const puzzleSeeds = [
      {
        orderNo: 1,
        type: 'single_choice',
        publicPayload: {
          prompt: 'Какое число должно быть следующим?',
          options: [
            { id: 'opt_24', label: '24' },
            { id: 'opt_30', label: '30' },
            { id: 'opt_32', label: '32' },
          ],
        },
        solutionPrivate: {
          correctOptionId: 'opt_32',
          correctFeedback: 'Верно! Каждое число в ряду умножается на 2: 2, 4, 8, 16, 32.',
          incorrectFeedback: 'Пока не получилось. Попробуй ещё раз и сравни соседние числа.',
        },
        hint: 'Сравни каждое число со следующим: во сколько раз оно увеличивается?',
      },
      {
        orderNo: 2,
        type: 'multiple_choice',
        publicPayload: {
          prompt: 'Какие утверждения верны для ряда 2, 4, 8, 16, 32? Выбери все подходящие.',
          options: [
            { id: 'doubles', label: 'Каждое следующее число вдвое больше предыдущего.' },
            { id: 'even', label: 'Все числа в последовательности чётные.' },
            { id: 'plus_two', label: 'Каждый раз прибавляется ровно 2.' },
            { id: 'descending', label: 'Последовательность убывает.' },
          ],
        },
        solutionPrivate: {
          correctOptionIds: ['doubles', 'even'],
          correctFeedback: 'Именно так: ряд удваивается, и все его числа чётные.',
          incorrectFeedback: 'Нужно отметить оба верных свойства и не выбирать отвлекающие утверждения.',
        },
        hint: 'Проверь отдельно правило перехода и чётность каждого числа.',
      },
      {
        orderNo: 3,
        type: 'numeric_input',
        publicPayload: {
          prompt: 'Продолжи последовательность: 2, 4, 8, 16, 32, …',
          placeholder: 'Введи следующее число',
        },
        solutionPrivate: {
          correctValue: 64,
          tolerance: 0,
          correctFeedback: 'Верно! После 32 идёт 64.',
          incorrectFeedback: 'Вспомни, во сколько раз увеличивается каждое следующее число.',
        },
        hint: 'Умножь последнее число на 2.',
      },
      {
        orderNo: 4,
        type: 'text_input',
        publicPayload: {
          prompt: 'Как называется правило, по которому каждое следующее число вдвое больше предыдущего?',
          placeholder: 'Например, одно слово',
        },
        solutionPrivate: {
          acceptedAnswers: ['удвоение', 'умножение на два', 'умножение на 2'],
          correctFeedback: 'Да, это удвоение: каждое значение умножается на два.',
          incorrectFeedback: 'Подумай, какое действие означает «умножить на два».',
        },
        hint: 'Здесь каждое следующее значение получается умножением на два.',
      },
      {
        orderNo: 5,
        type: 'ordering',
        publicPayload: {
          prompt: 'Расположи числа от первого члена последовательности к последнему.',
          items: [
            { id: 'sixteen', label: '16' },
            { id: 'two', label: '2' },
            { id: 'thirty_two', label: '32' },
            { id: 'four', label: '4' },
            { id: 'eight', label: '8' },
          ],
        },
        solutionPrivate: {
          correctOrderIds: ['two', 'four', 'eight', 'sixteen', 'thirty_two'],
          correctFeedback: 'Отлично! Последовательность восстановлена.',
          incorrectFeedback: 'Начни с наименьшего числа и каждый раз удваивай его.',
        },
        hint: 'Начинай с 2, затем переходи к числу, которое вдвое больше.',
      },
    ];

    for (const puzzleSeed of puzzleSeeds) {
      const puzzle = await client.query<{ id: string }>(
        `INSERT INTO puzzles
         (id, level_id, order_no, type, schema_version, public_payload,
          solution_private, max_attempts, max_score)
         VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6::jsonb, 3, 10)
         ON CONFLICT (level_id, order_no) DO UPDATE SET
           type = EXCLUDED.type, public_payload = EXCLUDED.public_payload,
           solution_private = EXCLUDED.solution_private,
           max_attempts = EXCLUDED.max_attempts, max_score = EXCLUDED.max_score
         RETURNING id`,
        [
          randomUUID(),
          level.rows[0].id,
          puzzleSeed.orderNo,
          puzzleSeed.type,
          JSON.stringify(puzzleSeed.publicPayload),
          JSON.stringify(puzzleSeed.solutionPrivate),
        ],
      );

      await client.query(
        `INSERT INTO hints (id, puzzle_id, order_no, body)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT (puzzle_id, order_no) DO UPDATE SET body = EXCLUDED.body`,
        [randomUUID(), puzzle.rows[0].id, puzzleSeed.hint],
      );
    }

    await client.query(
      `UPDATE quest_versions SET status = 'PUBLISHED', published_at = COALESCE(published_at, NOW())
       WHERE id = $1 AND status = 'DRAFT'`,
      [version.rows[0].id],
    );
    await client.query(
      `UPDATE quests SET status = 'PUBLISHED', updated_at = NOW() WHERE id = $1`,
      [quest.rows[0].id],
    );

    await client.query('COMMIT');
    process.stdout.write('Questoria demo quest with five puzzle types seeded successfully.\n');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error: unknown) => {
    console.error('Failed to seed Questoria content:', error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
