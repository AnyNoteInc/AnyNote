---
status: approved
date: 2026-07-25
topic: AnyNote public home page context-thread redesign
supersedes: 2026-04-30-home-page-claude-redesign-design.md
approved_by_user: 2026-07-25
---

# Главная «Любых заметок» — Context Thread Design

## Решение

Полностью переработать публичную главную «Любых заметок» вокруг одного продуктового
образа: выделенный фрагмент рабочего материала физически соединяется с другими
источниками и превращается в проверяемый ответ.

Пользователь выбрал визуальное направление № 1 «Контекстная нить», потребовал
собирать страницу штатным UI-китом AnyNote и отдельно утвердил использование только
семантических цветов `@repo/ui` из `createAppTheme()`.

## Бриф

- **Продукт:** «Любые заметки» — рабочее пространство для документов, баз, файлов,
  совместной работы и ответов ИИ по собственным источникам команды.
- **Конкретный посетитель:** Марина, руководитель команды из семи человек. После
  встречи ей нужно быстро восстановить обещание клиенту и проверить срок по исходным
  материалам.
- **Единственная задача главной:** убедить посетителя начать бесплатно после того,
  как он увидит путь «материал → контекст → проверяемый ответ».
- **Основной CTA:** гостю `Начать бесплатно` → `/registration`; вошедшему
  пользователю `Открыть рабочее пространство` → `/app`.
- **Язык:** русский.
- **Стек:** Next.js Server Components, `@repo/ui`/MUI 9, существующие Geist Sans и
  Geist Mono, `sx` и семантические CSS variables темы.

## Арт-дирекшн

### Визуальный тезис

Главная выглядит как активная рабочая поверхность, а не как рекламная галерея
возможностей. Одна непрерывная линия связывает реальную заметку, строку базы,
проектный документ и ответ с источниками. Линия несёт смысл и задаёт композицию
первого экрана и следующих секций.

### Что сохраняем

- Публичный бренд только «Любые заметки».
- Штатные компоненты и иконки `@repo/ui`.
- Light/dark/system режимы `UiProvider`.
- Auth-aware CTA и маршруты.
- SEO metadata, canonical, OpenGraph и JSON-LD.
- Существующие публичные section IDs и полезный контент.
- Контактную форму, тарифы, Open Source и юридический футер.

### Что убираем

- Lora и serif-типографику на главной.
- Кремово-серифно-терракотовую editorial-композицию как единый шаблонный образ.
- Декоративное оригами, точечную сетку, mono-eyebrow и случайные геометрические
  элементы.
- Browser chrome вокруг hero-preview.
- Bento-сетку возможностей, декоративные метрики и повторяющие друг друга карточки.
- Постоянный floating/scan motion.
- Emoji как продуктовые иконки, когда в `@repo/ui` есть MUI-эквивалент.

Тёплая палитра темы остаётся по прямому требованию пользователя, однако не
комбинируется с serif и editorial-сеткой. Отличимость создают продуктовая причинная
композиция, Geist и реальный UI.

## Система цвета

В homepage-компонентах запрещены новые hardcoded hex. Используются семантические
значения темы:

| Роль | Theme token |
| --- | --- |
| Canvas | `background.default` |
| Рабочая поверхность | `background.paper` |
| Основной текст | `text.primary` |
| Метаданные | `text.secondary` |
| Контекстная нить | `primary.main` |
| Hover/active нити | `primary.dark` |
| Тихий акцент | `primary.light` |
| Выделение фрагмента | `alpha(primary.main, 0.14)` |
| Границы и связи | `divider` |
| Основной CTA | `secondary.main` |
| Текст CTA | `secondary.contrastText` |
| Focus ring | `primary.main` |

Компоненты не переопределяют `secondary.contrastText` локальным цветом. Это устраняет
текущий дефект dark-mode CTA.

## Типографика

Главная использует только уже подключённые локальные variable fonts:

- **Display:** Geist Sans VF, `fontWeight: 500`, desktop `clamp(4rem, 7.4vw, 7rem)`,
  line-height `0.94`, letter-spacing `-0.055em`, максимум 11–12 символов в строке
  композиционного заголовка.
- **Section heading:** Geist Sans VF, `clamp(2.25rem, 4.6vw, 4.5rem)`,
  line-height `0.98`, letter-spacing `-0.045em`.
- **Body:** Geist Sans VF, 16–19 px, line-height 1.5–1.65, до 55–65 символов в строке.
- **Utility:** Geist Mono VF, 11–13 px, line-height 1.4, умеренный tracking; только
  для дат, типов источников и коротких технических меток.

Lora получает `preload: false`; homepage-варианты header/footer не используют
`--font-serif`, поэтому первый экран загружает только Geist Sans и Geist Mono.

## Композиция всей страницы

Порядок сохраняет текущие контрактные IDs, но превращает страницу в одно
повествование:

1. Hero — тезис и полная контекстная цепочка.
2. `#why` — проблема потери контекста и переход к решению.
3. `#modes` — единая рабочая поверхность вместо каталога режимов.
4. `#capabilities` — рабочие материалы, которые попадают в контекст.
5. `#search` — вопрос, ответ и проверяемые источники.
6. `#features` — компактный operating list без bento.
7. `#open-source` — прозрачность и собственная инфраструктура.
8. `#pricing` — тарифы; карточки допустимы, потому что план является отдельным
   сравниваемым объектом.
9. `#contact` — нестандартная конфигурация и рабочая форма.
10. Final CTA — повтор единственного действия.
11. Footer — навигация, юридические данные и контакты.

## Секции

### Hero

#### Desktop

Edge-to-edge section, минимальная высота `calc(100svh - header-height)`. Две
композиционные области без рамки приложения:

- Слева: H1 `Всё, что команда знала — находится.`, короткое объяснение, primary CTA и
  utility `Без карты · 2 минуты`.
- Справа и частично под текстом: четыре реальные рабочие поверхности:
  `Протокол встречи с клиентом`, `Стратегия редизайна`, строка базы
  `Обязательства` и ответ `Редизайн сайта — к 25 апреля`.

Контекстная нить начинается у выделенного предложения
`Мы взяли на себя обязательство: редизайн сайта — к 25 апреля`, последовательно
касается ещё двух источников и входит в ответ. Источники остаются в обычном DOM:
`Paper`, `Table`, `Typography`, `Stack`, MUI icons.

Hero не содержит secondary CTA, browser chrome, pills, метрик и декоративных
карточек.

#### Mobile

На ширине до 600 px контекстная цепочка становится вертикальной:

1. H1 и CTA.
2. Выделенный фрагмент встречи.
3. Строка базы.
4. Ответ с двумя источниками.

Элементы desktop не уменьшаются целиком. Текст и документы получают отдельные
mobile размеры; визуальная нить идёт слева и не перекрывает фокусируемые элементы.

### Why

Одна крупная фраза `Контекст теряется не в файлах — а между ними` и короткая
до/после-композиция:

- Разрозненное: встреча, проект, таблица.
- Связанное: вопрос и один ответ с источниками.

Не использовать цифры `10 секунд / 1 ссылка / 0 карт`: они декоративны и не
подтверждены продуктовой аналитикой.

### Modes

Вместо шести равных карточек — горизонтальная рабочая последовательность:

`Написать → Структурировать → Обсудить → Опубликовать`.

Каждый шаг — участок одной поверхности с реальным контентом и `@repo/ui` icon.
Последовательность кодирует настоящий жизненный цикл знания, поэтому подписи не
декоративны.

### Capabilities

Показать типы материалов в одном непрерывном списке, а не в bento:

- документы и страницы;
- таблицы, доски и календарь;
- схемы и холсты;
- файлы и импорт;
- публичные ссылки;
- чаты по рабочему пространству.

Справа меняется один компактный product fragment, связанный с активной строкой.
Desktop может использовать sticky layout; mobile отображает фрагмент после
соответствующей строки.

### Search

Кульминация контекстной нити:

- вопрос `Что мы обещали клиенту?`;
- ответ `Редизайн сайта и первый макет к 25 апреля`;
- реальные source rows `Протокол встречи`, `Стратегия редизайна`,
  `База обязательств`;
- короткое объяснение, что ответ строится по материалам пространства.

Источники интерактивно подсвечивают соответствующие фрагменты, но не ведут на
несуществующие маршруты.

### Features

Компактный двухколоночный список без карточек:

- совместное редактирование;
- история версий;
- уведомления;
- публичные формы и страницы;
- интеграции и API;
- импорт и экспорт.

Каждая строка содержит MUI icon, название и одно конкретное предложение. Заголовки
должны быть понятны без body copy.

### Open Source

Одна широкая `Paper`-поверхность с GitHub CTA, кратким объяснением прозрачности и
трёмя текстовыми аргументами: код открыт, можно развернуть у себя, изменения видны.
Не использовать фальшивое окно терминала.

### Pricing

Сохранить реальные данные и ссылки. Использовать `Paper`/`Button`/`Stack`; карточки
семантически оправданы отдельностью планов. Featured plan получает цвет
`primary.main`, но не декоративный ромб. На mobile карточки идут одной колонкой.

### Contact

Сохранить текущую форму и юридические согласия. Перекомпоновать section как
спокойную двухколоночную область без рекламной иллюстрации. Ошибка объясняет
следующее действие; success использует то же имя действия, что submit.

### Final CTA

Тезис `Перенесите рабочие знания туда, где их можно найти`, auth-aware CTA и
продолжение контекстной нити в край секции. Никакого отдельного декоративного
мотива.

### Header and footer

Добавить scoped homepage visual variant, не меняющий adjacent public pages:

- Header: Geist wordmark, семантический `header/nav`, skip link, существующие
  theme toggle и auth controls.
- Mobile: menu button и доступная навигация вместо полного исчезновения ссылок.
- Footer: Geist-only homepage variant, существующие юридические данные и контакты,
  без origami и serif.

## Компонентная граница

Сохраняется `apps/web/src/app/page.tsx` как Server Component, который отвечает за
session, CTA, JSON-LD и композицию.

Homepage-файлы остаются в
`apps/web/src/components/public/home/`. Добавляются:

- `home-context-tokens.ts` — только semantic aliases, geometry, typography and
  motion; без новой палитры.
- `home-context-thread.tsx` — визуальная связь и source highlights.
- `home-motion.tsx` — маленькая client boundary только при необходимости
  IntersectionObserver.

Существующие section-файлы переписываются на `@repo/ui`. Shared header/footer
получают явный variant prop; дефолтный variant сохраняет соседние страницы.

## Motion

### Full

- Hero copy: 160–360 ms fade/translate.
- Источники: появляются в причинном порядке с коротким stagger.
- Контекстная нить: 480–620 ms раскрытия после появления источников.
- Scroll reveals: один раз при входе, только `opacity` и `transform`.
- Hover/focus source: 120–160 ms tint и усиление соответствующего segment.

### Reduced motion

- Нить и все смысловые состояния сразу видны.
- Нет smooth scroll, stagger, floating и scroll-linked transforms.
- Допустим только короткий crossfade до 120 ms.

### Runtime budget

- Нет WebGL, canvas, Lenis, GSAP и постоянного rAF.
- SSR содержит полный сильный статичный hero.
- Client JS загружается только для необходимой интерактивности.
- Анимации используют compositor-safe properties.
- Page visibility не оставляет активных loops.

## Accessibility

- Semantic `header`, `nav`, `main`, `section`, `footer`.
- Skip link первым фокусируемым элементом.
- Один H1, логичная иерархия H2/H3.
- Весь декоративный connector `aria-hidden`; смысл цепочки присутствует в DOM
  текстом.
- Visible `:focus-visible`, минимум 3 px theme-derived ring.
- Контраст обычного текста не ниже 4.5:1.
- CTA minimum target 44×44 px.
- Keyboard order совпадает с визуальным чтением.
- Dark mode не использует hardcoded светлый текст.
- Mobile menu управляется кнопкой с label и корректным expanded state.

## Performance budgets

- LCP на Fast 3G < 2.5 s.
- CLS < 0.1.
- Первый экран < 1 MB.
- Не более трёх font files; целевой homepage path — два Geist files.
- При CPU 4× throttle целевой FPS около 60, без устойчивых просадок ниже 50.
- Не прелоадить below-the-fold изображения; новый hero не требует bitmap assets.

## Тестовая стратегия

### Unit/component

- CTA сохраняет guest/signed-in href и label.
- Homepage variant не меняет default header/footer.
- Reduced-motion стили оставляют все смысловые элементы видимыми.
- Theme tokens используются без hardcoded homepage palette.

### Playwright

Обновить `apps/e2e/home-redesign.spec.ts`:

- desktop 1440×1024: H1, CTA, section anchors, context chain and contact form;
- mobile 360×800: отсутствие horizontal overflow, CTA виден, цепочка вертикальна,
  mobile navigation доступна;
- keyboard: skip link, primary CTA and navigation have visible focus;
- `prefers-reduced-motion: reduce`: thread and content visible, no continuous
  animation;
- light and dark screenshots at the same viewport;
- CTA route contract;
- existing contact submission.

### Verification

- `pnpm --filter web check-types`
- `pnpm --filter web lint`
- focused web tests
- focused Playwright homepage spec
- production build or the narrowest equivalent needed for font/LCP inspection
- Playwright screenshots before/after at desktop and mobile

## Финальная самопроверка

1. **Без движения:** hero remains a strong poster and explains product.
2. **Под нагрузкой:** no heavy renderer; inspect CPU 4× and network behavior.
3. **Transitions:** source highlight, CTA and navigation states remain continuous.
4. **Reduced motion:** static causal chain remains complete.
5. **Подмена продукта:** without documents, database rows, question and citations
   the composition loses its meaning, so it is not a generic SaaS template.

## Non-goals

- Не менять глобальную brand palette `@repo/ui`.
- Не редизайнить product workspace, auth, pricing page or developer pages.
- Не менять тарифы, юридический текст, contact backend or business logic.
- Не добавлять analytics, A/B testing, new routes or CMS.
- Не выпускать релиз и не деплоить без отдельного запроса.

## Approval record

- Пользователь выбрал visual option 1.
- Пользователь потребовал использовать UI-kit AnyNote.
- Пользователь скорректировал цветовую систему: брать цвета из `@repo/ui` theme.
- После показа скорректированного плана пользователь ответил:
  `начинай сборку дизайна всей главной страницы`.
