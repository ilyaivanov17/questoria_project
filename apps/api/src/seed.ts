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
       VALUES ($1, $2, 'mystery-of-the-missing-number', 'PUBLISHED', NOW())
       ON CONFLICT (slug) DO UPDATE SET
         category_id = EXCLUDED.category_id, status = 'PUBLISHED', updated_at = NOW()
       RETURNING id`,
      [randomUUID(), category.rows[0].id],
    );

    const version = await client.query<{ id: string }>(
      `INSERT INTO quest_versions
       (id, quest_id, version_no, title, summary, objectives, age_min, age_max,
        difficulty, duration_min, locale, seo, status, published_at)
       VALUES ($1, $2, 1, 'Тайна пропавшего числа',
         'Помоги исследователю открыть шифрованную дверь: найди закономерность в числовом ряду.',
         $3::jsonb, 14, 99, 'Начальный', 8, 'ru',
         $4::jsonb, 'PUBLISHED', NOW())
       ON CONFLICT (quest_id, version_no) DO UPDATE SET
         title = EXCLUDED.title, summary = EXCLUDED.summary,
         objectives = EXCLUDED.objectives, age_min = EXCLUDED.age_min,
         age_max = EXCLUDED.age_max, difficulty = EXCLUDED.difficulty,
         duration_min = EXCLUDED.duration_min, seo = EXCLUDED.seo,
         status = 'PUBLISHED', published_at = NOW()
       RETURNING id`,
      [
        randomUUID(),
        quest.rows[0].id,
        JSON.stringify(['Находить числовые закономерности', 'Объяснять принцип решения']),
        JSON.stringify({
          title: 'Тайна пропавшего числа — логический квест',
          description: 'Найди закономерность в последовательности чисел и открой дверь.',
        }),
      ],
    );

    const level = await client.query<{ id: string }>(
      `INSERT INTO levels (id, quest_version_id, order_no, title, intro)
       VALUES ($1, $2, 1, 'Шифрованная дверь',
         'На двери мерцает последовательность: 2, 4, 8, 16. Какое число откроет замок?')
       ON CONFLICT (quest_version_id, order_no) DO UPDATE SET
         title = EXCLUDED.title, intro = EXCLUDED.intro
       RETURNING id`,
      [randomUUID(), version.rows[0].id],
    );

    const puzzle = await client.query<{ id: string }>(
      `INSERT INTO puzzles
       (id, level_id, order_no, type, schema_version, public_payload,
        solution_private, max_attempts, max_score)
       VALUES ($1, $2, 1, 'single_choice', 1, $3::jsonb, $4::jsonb, 3, 10)
       ON CONFLICT (level_id, order_no) DO UPDATE SET
         type = EXCLUDED.type, public_payload = EXCLUDED.public_payload,
         solution_private = EXCLUDED.solution_private,
         max_attempts = EXCLUDED.max_attempts, max_score = EXCLUDED.max_score
       RETURNING id`,
      [
        randomUUID(),
        level.rows[0].id,
        JSON.stringify({
          prompt: 'Какое число должно быть следующим?',
          options: [
            { id: 'opt_24', label: '24' },
            { id: 'opt_30', label: '30' },
            { id: 'opt_32', label: '32' },
          ],
        }),
        JSON.stringify({
          correctOptionId: 'opt_32',
          correctFeedback:
            'Верно! Каждое число в ряду умножается на 2: 2, 4, 8, 16, 32.',
          incorrectFeedback: 'Пока не получилось. Попробуй ещё раз и сравни соседние числа.',
        }),
      ],
    );

    await client.query(
      `INSERT INTO hints (id, puzzle_id, order_no, body)
       VALUES ($1, $2, 1, 'Сравни каждое число со следующим: во сколько раз оно увеличивается?')
       ON CONFLICT (puzzle_id, order_no) DO UPDATE SET body = EXCLUDED.body`,
      [randomUUID(), puzzle.rows[0].id],
    );

    await client.query('COMMIT');
    process.stdout.write('Questoria demo quest seeded successfully.\n');
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
