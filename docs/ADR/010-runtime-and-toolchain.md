# ADR-010: runtime и базовый стек MVP

- **Статус:** принято для Sprint 0; версии зависимостей обновляются отдельными PR.
- **Дата:** 2026-11-16

## Решение

- Node.js 22 LTS (фиксированная локальная версия в `.nvmrc`).
- pnpm 12 workspaces и один корневой lockfile.
- Frontend: Next.js 16.4, React и TypeScript.
- Backend: NestJS 12 как модульный монолит, REST API.
- Database: PostgreSQL 17.
- ORM: Prisma ORM 7; переход на Prisma 8 рассматривать после General Availability и проверки миграционного пути.
- Shared DTO/types: `packages/contracts`.
- Локальная БД: Docker Compose.

## Обоснование и ограничения

NestJS 12 документирует поддержку Node 20.19+ и Node 22.12+; поэтому выбран Node 22 LTS, а не непроверенная для этой связки версия runtime. Next.js 16.4 находится в активной LTS-линии. Prisma ORM 8 на дату решения имеет статус release candidate, поэтому для основы MVP выбран стабильный major 7.

Начальная схема Prisma содержит только основу пользователей, профилей и ролей. Полная доменная модель из MVP Execution Specification будет добавляться вместе с вертикальными срезами и миграциями — это не утверждение о готовности production-схемы.

## Ссылки

- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [Next.js 16.4 и поддерживаемые версии](https://nextjs.org/support-policy)
- [NestJS version compatibility](https://docs.nestjs.com/faq/versions)
- [Prisma ORM 7 PostgreSQL quickstart](https://www.prisma.io/docs/v7/prisma-orm/quickstart/postgresql)
- [Prisma ORM release status](https://www.prisma.io/docs/orm/release-status)
- [pnpm installation and Node compatibility](https://pnpm.io/installation)
