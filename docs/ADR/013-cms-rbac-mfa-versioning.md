# ADR-013: CMS, RBAC, MFA и неизменяемые версии контента

- **Статус:** принято
- **Дата:** 2026-11-17

## Контекст

Контент нужно создавать и проверять без нового deploy приложения. Автор не должен иметь возможности самостоятельно одобрить и опубликовать свой материал. Обычный пользователь не должен получать доступ к CMS через скрытие UI или угадывание URL. Опубликованные версии должны оставаться неизменными для уже начатых прохождений и истории результатов.

## Роли

- `AUTHOR`: создаёт рубрики и черновики квестов, редактирует только DRAFT и отправляет материал на проверку.
- `REVIEWER`: имеет права автора, просматривает review queue и одобряет версии; не публикует.
- `ADMIN`: имеет права автора и рецензента, публикует одобренные версии и читает audit log. TOTP MFA обязательна.
- `SUPER_ADMIN`: административные права, включая bootstrap-операции вне публичного API. TOTP MFA обязательна.
- Учащийся не имеет CMS-роли.

Назначение ролей не доступно через публичный API. После создания аккаунта Super Admin назначается явной CLI-командой с дополнительным флагом подтверждения. Bootstrap-команда пишет событие в audit log.

## Контентный workflow

`DRAFT → REVIEW → APPROVED → PUBLISHED`

- Автор отправляет только готовую версию в REVIEW.
- Reviewer не может одобрить версию, если он является её автором.
- Admin/Super Admin публикует только APPROVED-версию.
- Новая версия клонируется из последней опубликованной; существующий опубликованный snapshot не редактируется.
- Изменение публичного slug после первой публикации запрещено.
- Приёмка публикации проверяет metadata, цели обучения, навыки, возраст, язык, SEO, обложку и лицензионное описание, уровни, поддерживаемые puzzle types, приватный ключ решения, объяснение и подсказки.

## Security

- RBAC enforcement исполняется NestJS guards на каждом CMS endpoint.
- Для Admin/Super Admin используется TOTP RFC 6238: секрет зашифрован AES-256-GCM ключом `MFA_ENCRYPTION_KEY`; MFA подтверждается отдельно для каждой сессии.
- Все изменяющие CMS запросы требуют точного совпадения HTTP Origin с `WEB_ORIGIN`. Cookie остаётся HttpOnly, Secure в production и SameSite=Lax.
- Публичная регистрация не назначает CMS-роли.
- Audit log — append-only, доступ ограничен reviewer/admin ролями.
- Опубликованные версии, уровни, puzzles и hints защищены PostgreSQL-триггерами от UPDATE/DELETE и вставки новых дочерних записей в опубликованный snapshot.

## API

- `GET/POST /api/v1/admin/categories`
- `PATCH/DELETE /api/v1/admin/categories/:id`; Admin может опубликовать рубрику.
- `GET/POST /api/v1/admin/quests`
- `GET/PATCH /api/v1/admin/quests/:id`
- `POST /api/v1/admin/quests/:id/draft`
- `POST /api/v1/admin/quests/:id/submit-review`
- `POST /api/v1/admin/quests/:id/approve`
- `POST /api/v1/admin/quests/:id/publish`
- `GET /api/v1/admin/audit-logs`
- `POST /api/v1/admin/mfa/setup`, `POST /api/v1/admin/mfa/verify`

## Границы текущего среза

Медиа URL принимается как HTTPS или /media storage path, но file upload/object storage ещё не подключены. Skills хранятся как строковые ключи, а не как справочник. Нет MFA recovery codes, пользовательского управления ролями из UI, review assignment и preview tokens. Эти пункты остаются в backlog; опубликованные версии и public API уже получают базовую защиту.

## Проверки

CI проверяет schema и миграции PostgreSQL, RBAC-матрицу, MFA и CSRF guards, TOTP, seed и E2E-доступ: учащийся получает 403 на CMS endpoints. Полный reviewer→admin publish smoke для выделенных аккаунтов будет добавлен после настройки тестовых ролей в CI.
