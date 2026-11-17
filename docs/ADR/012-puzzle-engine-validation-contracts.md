# ADR-012: типизированный движок головоломок

- **Статус:** принято
- **Дата:** 2026-11-17

## Контекст

Первый вертикальный срез поддерживал только `single_choice`. Sprint 2 требует четыре дополнительных формата заданий, при этом правильные ответы и правила проверки не должны попадать в публичный API или frontend bundle.

## Решение

Все типы используют единый backend entry point `validatePuzzleAnswer`. Он получает тип, публичный payload, приватное решение и JSON-ответ пользователя. Результат проверки — только `isCorrect` и feedback; запись попытки, порядок заданий, лимит попыток, прогресс и rewards остаются в транзакции `QuestService`.

| Тип | Public payload | Private solution | Answer |
|---|---|---|---|
| `single_choice` | `options: [{id,label}]` | `correctOptionId` | `{optionId}` |
| `multiple_choice` | `options: [{id,label}]` | `correctOptionIds: string[]` | `{optionIds: string[]}` |
| `numeric_input` | `placeholder?`, `unit?` | `correctValue: number`, optional `tolerance` | `{value: string | number}` |
| `text_input` | `placeholder?` | `acceptedAnswers: string[]` | `{text: string}` |
| `ordering` | `items: [{id,label}]` | `correctOrderIds: string[]` | `{orderedIds: string[]}` |

## Правила валидации

- Неизвестные типы и некорректная форма ответа отклоняются HTTP 400.
- Single choice принимает только ID из публичного списка вариантов.
- Multiple choice требует непустой список уникальных ID из публичного списка и сравнивает полный набор без зависимости от порядка.
- Numeric input принимает конечное число либо десятичную строку с точкой или запятой (запятая нормализуется в точку); экспоненциальная запись/Infinity отклоняются. Допуск задаётся только приватным `tolerance`, по умолчанию 0.
- Text input ограничен 2000 символами и сравнивается после NFKC, trim, схлопывания пробелов, lowercase и нормализации русской `ё` к `е`.
- Ordering должен содержать каждый публичный item ID ровно один раз; порядок сравнивается с приватным `correctOrderIds`.
- Ошибочная конфигурация опубликованного решения считается ошибкой данных, а не неправильным ответом игрока.
- Public API возвращает только промпт, варианты/items, placeholder/unit и подсказки. Приватное решение никогда не сериализуется в public payload или ответ игрового GET API.

## UX / доступность

- Single choice отображается кнопками radio.
- Multiple choice — нативными checkbox.
- Numeric/text — обычными полями ввода с label.
- Ordering — список с кнопками перемещения вверх/вниз и доступными названиями действий; drag-and-drop не требуется.
- Каждый контроль поддерживает клавиатуру и не полагается только на цвет.

## Проверки

Unit tests покрывают корректные/некорректные ответы для каждого типа, tolerance чисел, нормализацию текста, полный набор вариантов, отсутствие дубликатов в ordering и запрет неизвестного типа. HTTP smoke test проходит demo quest из пяти типов и проверяет, что решения не доступны из public API и что ledger/rewards начисляются только один раз после полного прохождения.

## Последствия

- Схема PostgreSQL не меняется: `puzzles.type` уже хранится как строка, payloads — JSON.
- Новые типы допускаются только через явный allowlist backend validator; произвольный executable content не поддерживается.
- CMS должна использовать те же контракты и правила schema validation при публикации контента.
