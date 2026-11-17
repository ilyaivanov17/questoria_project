# Questoria

Questoria — образовательная игровая платформа с сюжетными миссиями, головоломками и системой прогресса.

Этот репозиторий является **единым monorepo проекта**: здесь хранятся продуктовая документация, исходный код приложения и автономный UI-прототип.

## Состав репозитория

- `quest_platform_prd.md` — основной PRD и технический blueprint.
- `questoria_mvp_execution_spec.md` — конкретная спецификация реализации MVP, API, данных, CMS и backlog.
- `questoria_master_blueprint.md` — собранный master-документ.
- `prototype/` — автономный интерактивный HTML-прототип; он не является production-приложением.
- `apps/web/` — Next.js frontend.
- `apps/api/` — NestJS backend.
- `packages/contracts/` — общие TypeScript-контракты.
- `prisma/` — схема PostgreSQL и миграции.
- `docs/ADR/` — принятые архитектурные решения (ADR-009–011).
- `infra/` — локальная инфраструктура.

## Технологическая база

- Node.js 22 LTS и pnpm 12.
- Next.js 16.4 + React + TypeScript.
- NestJS 12, REST API.
- PostgreSQL 17 + Prisma ORM 7.
- Docker Compose для локальной базы данных.

Архитектура MVP — модульный монолит. Redis, микросервисы, платежи и социальные функции на старте не добавляем.

## Локальный запуск

Требуются Node.js `22.23.5`, pnpm `12.17.0` и Docker с Compose.

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose -f infra/docker/docker-compose.yml up -d postgres
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm dev
```

После запуска:

- Frontend: http://localhost:3000
- API health: http://localhost:4000/api/health

Команды:

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm format:check
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm db:migrate
pnpm db:studio
```

После первого `pnpm install` необходимо сохранить созданный `pnpm-lock.yaml` в Git. Пока lockfile не добавлен, CI устанавливает зависимости без frozen-lockfile.

## Первый вертикальный квест

В базе есть seed-квест «Тайна пропавшего числа». После запуска frontend, API и PostgreSQL откройте `/quests`, зарегистрируйтесь, откройте миссию и пройдите её. API сохраняет сессию, попытки и статус прохождения в PostgreSQL.

## Прототип

Откройте `prototype/index.html` напрямую в современном браузере. Инструкция и ограничения находятся в `prototype/README.md`.

Прототип хранит ответы и прогресс в браузере. Не используйте его для реальных аккаунтов или конфиденциальных данных. В production ответы, состояние прохождения и начисления должны проверяться и сохраняться на сервере.

## Правила разработки

1. PRD и MVP Execution Specification — источники требований.
2. Изменение архитектуры фиксируется в ADR.
3. Разрабатываем вертикальными срезами: интерфейс → API → база → тесты → документация.
4. Ответы, XP, монеты и права доступа никогда не доверяются клиенту.
5. Для каждой функции добавляются acceptance criteria, тесты и обработка ошибок.
6. Изменения вносятся через feature-ветку и Pull Request.

Текущий этап: **Sprint 2 — награды, ledger и профиль**. Реализованы регистрация и вход, публичный каталог, первая миссия, защищённое прохождение, XP/монеты с транзакционным начислением, append-only Ledger, профиль, прогресс и история начислений. Первое прохождение демонстрационного квеста приносит 40 XP и 15 монет; повторное прохождение этой же версии не создаёт новые валютные записи.

## Проверки качества

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI дополнительно применяет миграции PostgreSQL, загружает seed-квест, запускает API и выполняет `scripts/smoke.mjs`. Smoke test проверяет регистрацию, cookie sessions, сохранение прохождения, серверную проверку ответов, идемпотентные повторы, восстановление результата после входа, начисление XP/монет, запрет повторного фарминга наград и изоляцию чужих профилей.

Профиль доступен по адресу `/profile`. API кошелька: `GET /api/v1/me/wallet`; баланс вычисляется из append-only `wallet_ledger`. Награды за первое прохождение демонстрационной версии: 40 XP и 15 монет (уровень + квест + итоговое задание).

**Ограничение:** это development MVP, не публичный production-релиз. Пока нет подтверждения email, восстановления пароля, CMS, административного RBAC/MFA, дополнительных типов головоломок, трат/косметического магазина и законченных юридических/privacy-процессов для беты. До публичного запуска необходимо закрыть эти требования и провести security/privacy review.

Архитектурные решения: [ADR-009](docs/ADR/009-monorepo-in-existing-repository.md), [ADR-010](docs/ADR/010-runtime-and-toolchain.md) и [ADR-011](docs/ADR/011-wallet-ledger-and-rewards.md).
