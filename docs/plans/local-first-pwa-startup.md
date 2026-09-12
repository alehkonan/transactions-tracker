# Local-first PWA startup and reauthentication

Статус: **план реализации, приложение ещё не изменено**. Дата: 2026-09-11.

Этот документ предназначен для исполнения в новых сессиях, в том числе менее сильной моделью. Все пути ниже относительно корня репозитория. Не считать предлагаемые имена новых файлов существующими: сначала проверить дерево. Не выполнять все задачи одним большим изменением.

## 1. Цель и принятое решение

Повторное открытие приложения с уже сохранённой локальной репликой не должно ждать HTML от Netlify Function, проверку серверной сессии, обновление токенов, PostgreSQL или синхронизацию.

**Решение пользователя:** после истечения серверной сессии просмотр и локальное редактирование остаются доступны. Повторный вход требуется для синхронизации, а не для открытия локального рабочего пространства.

Решение зафиксировано в [ADR 0003](../adr/0003-local-access-independent-of-server-session.md). Термин local replica определён в `CONTEXT.md`. Это не обещание шифрования локальных данных или немедленной офлайн-блокировки после удалённого отзыва сессии.

Целевая последовательность:

```text
Версионная анонимная оболочка из локального кэша
  → запуск клиента и чтение IndexedDB
  → локальные данные и редактирование доступны
  → отдельно: авторизация синхронизации и обмен с сервером
```

Первый визит без установленного worker и без реплики требует сети. Удалённые браузером хранилища восстановить без сети невозможно. Внешний системный splash установленной PWA полностью не контролируется приложением.

### Продуктовые границы

- Поддерживается одна активная локальная реплика на origin, а не переключатель нескольких сохранённых аккаунтов.
- Истечение сессии, отсутствие сети, `401`, `503` и таймаут **не удаляют** локальные строки, выбор профиля, курсоры или outbox.
- Повторный вход тем же пользователем сохраняет реплику и идентичность всех мутаций.
- Данные пользователя A никогда не отправляются под серверной идентичностью B.
- Управление паролями/passkeys и другие серверные операции по-прежнему требуют настоящей аутентификации. Они не становятся локальными операциями.
- Сроки access/refresh token в этой работе не увеличивать. Холодный старт устраняется из критического пути UI, а не маскируется продлением сессии.
- Установка обновления приложения не должна самопроизвольно перезагружать открытые формы.

### Консервативные defaults этого плана

Это рекомендации плана, а не дополнительные ответы пользователя:

1. Вход из существующей реплики — **повторная аутентификация её владельца**. Для другого пользователя сначала предлагается явный выход с предупреждением об удалении локальной копии; не добавлять автоматическую смену владельца после любого успешного логина.
2. Неоднозначная старая реплика сохраняется для восстановления, но не присваивается тому, кто следующим ввёл пароль.
3. Поведение явного выхода при недоступном сервере не расширять: не обещать успешный выход и не стирать данные при сетевой ошибке. Полноценный offline sign-out с отдельным маркером и отложенным отзывом сессии — вне этой работы.
4. Background Sync worker временно не отправляет outbox, пока для него нет полноценного owner-aware settlement по ADR 0001. Сохранение очереди важнее фоновой отправки после закрытия окна.
5. Обновления worker пассивные: применяются после закрытия старых окон; автоматический `skipWaiting` и reload не используются.

## 2. Обязательное чтение и ограничения исполнителя

Перед каждой задачей прочитать `AGENTS.md`, `CONTEXT.md`, `docs/architecture.md`, `docs/limitations.md`, ADR 0001–0003 и соответствующий раздел этого плана.

- Не читать/печатать `.env*`; имена переменных брать из `.env.example`. Не сохранять auth cookies, пароли, токены или HAR с секретами в репозиторий.
- Не использовать production для тестов, создающих пользователей, транзакции, изменения credentials или удаляющих данные. Production допускается для анонимной проверки доставки shell/worker.
- Не добавлять зависимости без согласования. Для реального IndexedDB уже есть браузерный Playwright; отсутствие `fake-indexeddb` не повод автоматически добавлять пакет.
- Не коммитить, не деплоить, не выполнять разрушительные DB/Git-команды без отдельного разрешения.
- Сохранять local-first mutations: durable IndexedDB commit → Zustand → sync.
- Сохранить server-only DB access, существующие ownership checks, receipt/idempotency semantics и transaction budgets.
- Не менять серверную схему только ради клиентской идентичности реплики. Если серверная миграция всё же нужна для отдельной зависимости, использовать штатные `db:generate`/`db:migrate`, не `push`.
- Новые UI-компоненты: существующие semantic tokens и native controls; Dialog/Popover/Toast при необходимости. Новые workflow-тесты — через стабильные `data-testid`.
- После перемещения маршрутов запускать `pnpm generate-routes`, не редактировать `src/routeTree.gen.ts` вручную.

## 3. Установленные факты: откуда начинать

### Замеры production, не SLA

Анонимный Chromium, без искусственного throttling, `https://crackertracker.netlify.app`:

| Проверка                              | Наблюдение                                                              |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Первое открытие `/` → `/login`        | FCP около 10.40 с; этап redirect около 9.19 с                           |
| Повторное открытие `/` → `/login`     | FCP около 0.76 с                                                        |
| Отдельная повторная загрузка `/login` | LCP около 0.95 с, TTFB 0.881 с, render delay 0.068 с                    |
| Полученный `/sw.js`                   | HTTP 200, но classic-script parse падает на `Unexpected token 'export'` |
| Реальная попытка регистрации          | `ServiceWorker script evaluation failed`                                |
| Чистый проверенный браузер            | Нет registration/controller; Cache Storage пуст                         |

Это не измерение авторизованной установленной PWA пользователя. Холодный старт Netlify согласуется с первым наблюдением, но его доля не доказана серверными логами. Длительность `Loading your data…` с настоящей репликой не измерена. Старый установленный worker у пользователя мог сохраниться.

### Текущие препятствия в коде

| Файл/узел                                                         | Что исправляется                                                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `vite-plugins/offline-service-worker.ts`                          | Замена маркера оставляет вставку внутри `/* ... */`; regex удаления `export` и строки `\n` переэкранированы                             |
| `public/sw.js`                                                    | Navigation network-first; успешный HTML любого маршрута записывается под `/`; новый worker сразу активируется                           |
| `src/components/ServiceWorkerRegistration.tsx`                    | Безусловный reload на `controllerchange`, ошибка регистрации подавляется                                                                |
| `src/routes/__root.tsx`                                           | До чтения IDB требует live session/profile hints; SSR зависит от cookies/pathname                                                       |
| `src/routes/login.tsx`, `src/routes/index.tsx`                    | Дополнительные redirects; login может быть недоступен при живом, но отвергнутом сервером hint                                           |
| `src/modules/sync/SyncGate.tsx`                                   | `401` уводит в login даже при готовой реплике                                                                                           |
| `src/modules/sync/SyncStatus.tsx`                                 | Нет отдельного представления «войдите для синхронизации»; после удаления redirect возможен ложный `Synced`                              |
| `src/modules/auth/usePasskeyAuth.ts`, `usePasswordAuthForm.ts`    | Любой успешный вход вызывает `resetLocalData()`                                                                                         |
| `src/api/auth.functions.ts`                                       | Успешные способы входа уже возвращают `{ id, username }`; клиенты не используют identity для reconciliation                             |
| `src/modules/sync/idb.ts`                                         | IDB v2 без owner/generation; upgrade удаляет все stores; blocked delete считается успешным                                              |
| `src/modules/sync/sync-engine.ts`                                 | Sync lock не охватывает reset/login; старые async results могут опубликоваться после reset; не все triggers останавливаются после `401` |
| `src/modules/sync/sync-run.ts`                                    | Stale/full repull очищает рабочие строки **до** успешного получения замены                                                              |
| `src/modules/profile/profile-cookie.ts`, `src/routes/profile.tsx` | Выбор профиля основан на cookies и server function                                                                                      |
| `src/modules/profile/profile-mutations.ts`                        | Создание профиля ждёт `pushNow()` прежде чем вернуть успех                                                                              |
| `src/api/sync.functions.ts`, `src/routes/api/push.ts`             | Проверяют текущего пользователя, но не ожидаемого владельца исходной локальной реплики                                                  |
| `public/sw.js` outbox adapter                                     | Подтверждённые entries удаляются без полного settlement; это не соответствует ADR 0001                                                  |

Обычная локальная загрузка **уже** идёт перед `syncNow()` в `bootSync()`. Не переписывать весь sync engine, считая его изначально network-first.

## 4. Инварианты: запрещено нарушать даже временно при релизе

1. Сохранённая пригодная реплика открывается без серверного подтверждения сессии.
2. Сохранение локального изменения не проверяет срок серверной сессии и не ждёт сеть.
3. `saved locally` не означает `synced`. Статус не должен лгать ни при неизвестной сессии, ни после reload.
4. Локальный owner ID — маршрутизация/защита от смешения, не серверная авторизация. Сервер берёт действительного user ID только из проверенной сессии.
5. На каждом pull page, push batch, integrity request сервер сравнивает actual user с expected replica owner **до** domain reads/writes/receipt claims. Auth refresh сам может обращаться в БД.
6. Ответ от A не изменяет реплику B или новую инкарнацию A. Сравнения одного `userId` недостаточно для A → B → A.
7. Reset, обновление worker, миграция и `401` не должны незаметно удалять неотправленные изменения.
8. Sign-in success, cookie hint и HTTP 200 от `/sw.js` не считаются доказательством правильного локального boot/worker install.
9. Кэшируемая оболочка не содержит персональной информации, cookies, session hints, IDB rows или server-rendered redirect payload.
10. Отказ нового install оставляет старую рабочую версию пригодной. Нет смеси HTML версии A и случайно найденных assets версии B.

## 5. Целевые состояния и контракты

### 5.1 Не сводить всё к одному `isAuthenticated`

Разделить как минимум:

- `localState`: loading / absent / available / recovery-required / storage-error;
- `syncAuth`: unknown / authenticated / login-required / owner-mismatch;
- transport/progress: idle / syncing / offline / retryable-error / terminal-error;
- durable replica lifecycle: active / transitioning / signed-out (или эквивалентные явные состояния).

Конкретные названия union types можно согласовать с кодом, но независимость смыслов обязательна.

| Ситуация                                   | UI и действия                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Local loading                              | Нейтральный короткий boot state, без серверного запроса как условия завершения       |
| Available + session hint истёк/отсутствует | Открыть локальный workspace, `login-required`, разрешить изменения                   |
| Available + пригодный hint                 | Открыть workspace; sync может проверить сессию в фоне                                |
| Sync вернул `401`                          | Оставить workspace; сохранить очередь; показать CTA входа; остановить auto retries   |
| Offline/таймаут/`503`                      | Не объявлять пользователя разлогиненным; оставить local доступ                       |
| No replica + no session                    | Показать вход; без бесконечного `Loading your data…`                                 |
| No replica + подтверждённая identity       | Bind пустую реплику; первоначальная progressive загрузка                             |
| Owner mismatch                             | Не синхронизировать/не смешивать; отдельное reconciliation-состояние, без стирания A |
| IDB недоступна                             | Честная ошибка локального хранилища, не «всё сохранено» и не автоматическая очистка  |

`session_hint` остаётся необязательной оптимизацией. Ни его отсутствие, ни срок не блокируют local boot. На `/login` должна существовать явная reauth-ветка, даже если hint ещё живой.

### 5.2 Durable metadata

Предлагаемый минимальный контракт в существующем `meta` store:

```ts
type ReplicaIdentity = {
  ownerUserId: number;
  replicaId: string; // UUID, новый при создании/замене, не при same-user reauth
  username: string; // только отображение
};
```

Дополнительно хранить:

- lifecycle и transition marker с достаточно ясным crash-recovery состоянием;
- `selectedProfileId`, проверяемый по живым локальным профилям;
- `localRevision` — увеличивается при локальных финансовых изменениях, для fencing staged rebuild;
- readiness/completeness reference tables и `lastSyncedAt`;
- отдельно состояние legacy migration, если owner ещё не установлен.

Не записывать access/refresh token в IDB или localStorage. Не использовать username как устойчивый ID. Не добавлять `userId` в финансовый mutation payload: контекст владельца передаётся в envelope.

### 5.3 Sync protocol

Ввести явную версию sync wire protocol, например `protocolVersion: 2` (это **не** версия IDB):

```ts
type ReplicaSyncContext = {
  protocolVersion: 2;
  expectedOwnerUserId: number;
};

// существующие аргументы сохраняются внутри расширенного envelope:
// pullChanges({ ...context, cursors?, withCounts? })
// pushChanges({ ...context, mutations })
// checkIntegrity({ ...context })
// POST /api/push — тот же push envelope
```

- Общая runtime validation для RPC и HTTP push.
- `401` — нет пригодной сессии.
- `409` + machine-readable `REPLICA_OWNER_MISMATCH` — другая server identity. Не смешивать с существующим конфликтом fingerprint мутации.
- Missing/unsupported protocol — машинно различимая ошибка обновления клиента; fail closed до обработки мутаций. Не принимать legacy push «для совместимости» в финальном контракте.
- Successful envelopes возвращают подтверждённый `ownerUserId` и версию протокола, включая пустые ответы.
- Не возвращать в mismatch чужие финансовые строки. UI не обязан узнавать имя B из ошибки.
- Один preflight `who am I` не заменяет проверку каждого запроса: cookies могут измениться после preflight.
- Для пустой/legacy реплики добавить небольшую server function получения identity (например `getSyncIdentity` в `src/api/auth.functions.ts`). Для warm local boot **не ждать** её.
- Сохранять текущие signed access token semantics: отсутствие запроса к БД на valid-access ветке нормально.

### 5.4 Same-user reauthentication

Оба auth hook должны вызывать один общий coordinator (предлагаемый файл `src/modules/auth/complete-sign-in.ts`), а не собственные reset-ветки.

Для входа из bound replica передавать в server auth finalization `expectedUserId`:

1. Сервер доказывает credentials обычным способом.
2. Сравнивает их user ID с expected ID, если он передан.
3. При несовпадении возвращает явную ошибку **до** `createSession()` и установки cookies.
4. При совпадении выдаёт сессию и `{ id, username }`.
5. Клиент ещё раз проверяет исходный replica context, сохраняет owner/replicaId/outbox/cursors/selection и возобновляет sync.

Проверка expected ID — дополнительный барьер от случайной смены аккаунта, не замена проверки credentials. Применить к password, явному passkey и conditional/autofill. В reauth-режиме не предлагать signup поверх существующей реплики.

При желании войти как B: предложить отдельный явный sign-out/discard flow с актуальным предупреждением о local-only obligations; затем обычный вход в пустое workspace. При внешнем изменении cookies на B — fail closed на sync, не автоматический reset/rebind.

### 5.5 Параллельность и старые callbacks

- Capture `{ ownerUserId, replicaId }` при начале операции, а не подставлять текущего пользователя после `await`.
- IDB mutations/pull commit/settlement/selection/reset проверяют ожидаемую identity/lifecycle **в той же readwrite-транзакции**, которая меняет данные. Включить `meta` в transaction scope.
- Перед публикацией Zustand/status/conflicts/outboxCount повторно проверять контекст. Защитить boot hydration, peer hydration, retries и integrity callbacks.
- Settlement сопоставляет исходные mutation IDs/seq; один `seq` после reset недостаточен.
- Формы и CSV import привязаны к исходному replicaId; при replacement remount/clear. Старый draft A нельзя сохранить с новым binding B, прочитанным в момент submit.
- Cookie-changing auth finalization, sign-out и sync координировать browser-wide Web Lock; локальные изменения не держать за сетевым lock.
- Не делать reentrant acquire одного lock из функции, уже владеющей им: явно разделить coordinator и внутренние операции.
- Все network операции, способные через `resolveSession()` менять cookies, включить в аудит (в том числе security settings). Поздний refresh/clear-cookie ответ не должен перетирать новую сессию.
- BroadcastChannel ускоряет invalidation, но не является источником истины: sleeping tab сверяется с IDB при resume и каждом durable write.
- На transition соседние вкладки инвалидируют старый workspace до повторного открытия. Не просто `reload` после потенциально заблокированного удаления.
- При отсутствии Web Locks нельзя выдавать per-tab promise chain за cross-tab безопасность. Для этой реализации допустим явный fail-closed для небезопасных sync/auth transitions с объяснением несовместимости браузера; local просмотр/изменения сохраняются. Альтернативный IDB lease требует отдельного проекта и тестов, не импровизации.

## 6. Порядок задач

> **Прогресс:** T0, T1, T2 и T3 завершены. Следующий шаг — **T4: общий auth coordinator, lifecycle и fencing**.

Каждая задача: прочитать перечисленные файлы → добавить failing regression test на конкретное поведение → минимальная реализация → targeted tests → краткий отчёт (изменения/команды/ограничения). Документационный план сам по себе не доказывает прохождение тестов.

Зависимости:

```text
T0: воспроизведение и harness
 ├─ T1: исправная сборка worker
 ├─ T2: durable replica identity + недеструктивная миграция
 │   └─ T3: owner-aware server sync + reauth contracts
 │       └─ T4: auth coordinator + lifecycle/fencing
 │           └─ T5: локальный boot + статусы + локальный профиль
 │               └─ T6: недеструктивный full refresh
 └─ T7: anonymous SPA shell + static routing (использует T1 и T5)
     └─ T8: cache-first worker + пассивные обновления
         └─ T9: интеграционные сценарии и выпуск (требует T6 и T8)
```

T1 можно реализовать отдельно, но не выкатывать исправленный worker с небезопасным старым background push. T2–T6 не релизить по частям, оставляя owner-aware и legacy пути вперемешку. T7 можно исследовать параллельно T2–T4, но route/UI edits выполнять после T5 во избежание конфликтов.

### T0. Зафиксировать красные проверки и подготовить окружение

Файлы: `vite-plugins/offline-service-worker.test.ts`, `e2e/offline-cold-start.spec.ts`, `e2e/boot-gate.spec.ts`, `e2e/fixtures/`, `playwright.config.ts`, `package.json`.

1. Проверить актуальный git status. Не исправлять чужие незакоммиченные изменения.
2. Проверить доступность `http://localhost:5454/`. Не предполагать, что dev-сервер тестирует production worker: регистрация в dev выключена.
3. Добавить classic-script parse + top-level execution тест к сгенерированному worker (см. T1). Увидеть нынешний fail.
4. Сформировать минимальную test replica A с профилем, счётом, транзакцией и одной outbox mutation. Использовать реальный IDB в browser tests.
5. Сценарий expired-session должен сохранять **тот же** browser context и IDB, удаляя только auth/hint cookies. Существующий `contextWithStaleHints()` создаёт пустое хранилище и проверяет другой случай.
6. Новые PWA-тесты не ограничивать текущим единственным `offline-cold-start.spec.ts`: расширить `testMatch`, `testIgnore` и `test:e2e:pwa` согласованно.
7. Разделить анонимные shell/worker тесты и auth fixtures. Нехватка E2E credentials не должна блокировать анонимный worker parse/install smoke.
8. Production-preview проверки должны строить свежие артефакты: исключить reuse устаревшего preview; задать bounded build/start timeout.
9. Перед offline/slow-online сценарием явно проверить `navigator.serviceWorker.controller` и версию загруженной оболочки. Одного `navigator.serviceWorker.ready` недостаточно: registration может быть активной, но ещё не контролировать текущую страницу. При необходимости выполнить обычную document navigation и проверить контроль повторно.

Готово, когда есть воспроизводимые failing проверки: invalid worker; local replica + expired hint уходит в login; same-user reauth вызывает удаление; slow online navigation ждёт сеть. Не обязательно все четыре в одном тесте.

### T1. Исправить генератор worker, не меняя domain sync semantics

Файлы: `vite-plugins/offline-service-worker.ts`, соответствующий `.test.ts`, `public/sw.js`, `src/components/ServiceWorkerRegistration.tsx`.

1. Заменять полный marker comment `/* __OUTBOX_ACCEPTANCE_KERNEL__ */`, проверяя ровно одно вхождение.
2. Исправить regexp removal of runtime exports и реальные переводы строк в обёртке. Не менять portable acceptance kernel ради маскировки ошибки генерации.
3. В тесте собрать worker, разобрать через `node:vm.Script` как **classic script**, затем исполнить top level в sandbox с mock `self.addEventListener`/browser globals. Проверить доступность kernel и регистрацию обработчиков.
4. Проверить отсутствие неразрешённых placeholders и imports/exports в исполняемой части. `node --check` сам по себе недостаточен для classic-worker semantics в ESM-проекте.
5. Ошибки регистрации/install сделать наблюдаемыми: sanitized warning и ненавязчивый статус «Offline mode unavailable», не бесконечный toast при каждом render.
6. Отключить регистрацию `outbox-sync` из `src/modules/sync/mutations.ts` и worker drain до выполнения ADR-compatible owner-aware settlement. Server `/api/push` всё равно защищается в T3 от старых worker.
7. Не считать T1 решением задержки: navigation caching меняется в T8.

Проверки: classic parse/execute проходит; реальная browser registration достигает installed/active; ошибка install не скрыта. Ни один отключённый worker path не удаляет outbox.

### T2. Идентичность реплики, миграция IDB и локальные атомарные проверки

Файлы: `src/modules/sync/idb.ts`, `idb.test.ts`, `sync-types.ts`, `outbox.ts`, `mutations.ts`; предлагаемые `replica-identity.ts`/`replica-identity.test.ts` в том же модуле.

1. Ввести descriptor и guarded persistence APIs из §5.2/5.5. Не превращать component props в источник ownership authority.
2. Перейти на additive IDB v3. Существующие stores v2 **не пересоздавать**. Outbox seq, ordering, mutationId, payload, timestamps/base intent сохраняются побитово по сериализованным значениям.
3. Общий источник IDB name/version использовать для page и build-time worker stamping. Не держать две независимые числовые версии.
4. `versionchange` закрывает connection и инвалидирует client context. `blocked` — ошибка/состояние ожидания, не успех. Rejected cached database promise допускает явный retry.
5. Для явного discard предпочесть одну fenced transaction очистки данных и установки lifecycle marker вместо гонки `deleteDatabase()` + немедленный boot. Если удаление БД остаётся, не сообщать успех до фактического `success` и отдельно сохранять signed-out intent.
6. Local commit включает metadata check/revision increment в transaction с rows/outbox. Старые closures не легализуются новым descriptor.
7. Initial snapshot содержит descriptor, selection, readiness и financial rows из согласованного чтения.

#### Миграция ownership из v2

Schema upgrade и установление владельца — разные операции. Не выполнять сеть внутри `onupgradeneeded`.

- Пустая v2 без строк/obligations: можно bind после server-confirmed identity.
- Ровно один non-null `profiles.userId`, без признаков смешения: сохранить как **legacy owner candidate**; локальный просмотр/редактирование существующего workspace не блокировать истечением сессии. Sync разрешить только после проверки candidate против server-confirmed identity и согласованности ссылок/очереди. Candidate не даёт серверных прав.
- Owner candidate отличается от вошедшего пользователя: ничего не отправлять и не удалять; предложить вход правильного владельца.
- Несколько owner IDs, outbox-only, только locally-created профили с `userId: null`, повреждённые/неоднозначные ссылки: `recovery-required`. Сохранить исходную БД/obligations, **не присваивать их следующему вошедшему**.
- Для ambiguous recovery показать понятный экран и действие скачать локальный recovery export (только на устройство пользователя, без серверной отправки; предупредить о финансовых данных). Включить версию, rows, metadata, outbox; исключить cookies/credentials. Не добавлять автоматический import/rebind из этого файла в рамках задачи.
- Не стирать legacy storage после неудачной миграции. Не заявлять успешную миграцию при blocked upgrade.

Ambiguous recovery — исключение из-за неизвестного владельца старых данных, **не** возврат к запрету local доступа при обычном истечении сессии. Нельзя надёжно восстановить отсутствующий owner ID из username или произвольного hint.

Проверки: реальная v2→v3 сохраняет queue; valid same-owner migration; empty/mixed/outbox-only cases; blocked upgrade; stale mutation rejects; A→B→A rejects старый replicaId; failed IDB commit не показывает «Saved».

### T3. Серверный owner-aware протокол и безопасное завершение входа

Файлы: `src/api/sync-schemas.ts`, `sync.functions.ts`, `auth.functions.ts`, `auth.middleware.ts`, `session.server.ts`, `src/routes/api/push.ts`, `src/api/push-execution.server.ts`; их существующие и новые focused tests.

1. Реализовать §5.3 на всех sync entry points. Общую проверку владельца выполнить до передачи управления domain execution. Существующие per-row checks не удалять.
2. Сохранить fingerprint-conflict response отдельно от owner/protocol mismatch.
3. Передавать verified owner в success envelope; обновить клиентские response normalization/types, включая JSON date handling HTTP пути.
4. Добавить `getSyncIdentity` только для bootstrap/reconciliation, не в root navigation loader.
5. В finalization password/passkey auth добавить expected-owner проверку из §5.4. Возвращать server-confirmed identity; не доверять username/cookie hint для сравнения.
6. Старый worker без version/owner получает fail-closed response до receipt/mutation writes. Новый worker пока не отправляет (T1).
7. Не переименовывать существующие server function exports/файлы без необходимости: старые клиенты используют сгенерированные RPC identifiers. Проверить compatibility, не предполагать стабильность при перемещении server функций.

Проверки: A cookies + expected B отвергаются для pull/push/integrity/HTTP push, даже пустого batch; не создаются receipts/профили. Expected A сохраняет обычное поведение. Credentials B + reauth expected A не устанавливают сессию B. `401`/owner mismatch/protocol mismatch различимы клиентом.

### T4. Общий auth coordinator, lifecycle и fencing

Файлы: `src/modules/auth/usePasskeyAuth.ts`, `usePasswordAuthForm.ts`, `SignOutButton.tsx`, предлагаемый `complete-sign-in.ts`; `src/modules/sync/sync-engine.ts`, `mutations.ts`, `useSyncStore.ts`; import-state consumers.

1. Убрать unconditional `resetLocalData()` после успешного входа. Все способы входа, включая autofill, используют один coordinator.
2. Same-user: сохранить replicaId, rows, exact outbox entries, cursors, selection, pending notices; обновить display metadata; снять auth pause; запустить sync ровно через общий scheduler.
3. Failed/cancelled login не меняет durable obligations. После interrupted auth transition восстановить local доступ к исходной реплике, но не возобновлять sync под неизвестной identity автоматически.
4. Different-user login из reauth отклоняется без замены workspace. Предложить explicit sign-out flow, а не скрытое удаление.
5. Скоординировать cookie-changing finalization и sync с общим lock; transition marker до опасных операций; результат получает captured identity. Не держать WebAuthn prompt под долгим sync lock: координатор охватывает server finalization, не ожидание пользователя.
6. Fencing всех IDB/memory/status/timer callbacks по §5.5. `resetLocalData()` заменяется/оборачивается lifecycle-aware operation; нельзя просто очистить Zustand, пока старый pull ещё работает.
7. Sign-out подтверждение читает актуальные durable obligations. Успешный выход очищает также drafts/import state и legacy financial remnants, чтобы другой пользователь их не унаследовал. Server failure сохраняет local replica и честно сообщает неуспех.
8. Протокол межвкладочных сообщений содержит replicaId/тип события; stale messages игнорируются. На resume перепроверять durable lifecycle, не полагаться на доставленный broadcast.
9. Повторный вход из `/login` возвращает в прежний локальный маршрут, не заставляет снова выбрать профиль. Return destination — только допустимый same-origin UI path, без open redirect.

Проверки: password/explicit passkey/autofill same-user сохраняют exact queue; delayed A pull/push/hydration после reset не портят B; stale form/import не сохраняются в B; sleeping tab инвалидируется; повторное открытие после crash transition не зависает и не стирает obligations.

### T5. Local boot, статусы и локальный выбор профиля

Файлы: `src/routes/__root.tsx`, `src/routes/login.tsx`, `src/routes/index.tsx`, `src/routes/profile.tsx`; `src/modules/sync/SyncGate.tsx`, `SyncStatus.tsx`, `sync-engine.ts`, `useSyncStore.ts`; `src/modules/profile/*`; call sites `readSelectedProfileId`.

1. Boot сначала читает replica metadata/rows. Разделить завершение local boot и promise сетевого sync. Ни router guard, ни local-ready UI не ждут auth RPC/sync lock.
2. Убрать зависимость local route access от `hasLiveSessionHint()`. При отсутствии реплики client gate решает bootstrap/login после local inspection, а не до него.
3. `SyncGate` больше не перенаправляет гидратированную реплику на `/login` при `401`. Empty bootstrap получает понятный вход/retry/storage-error вместо вечного spinner.
4. При expired/missing hint + bound replica сразу выставить `login-required`; не стучаться в сеть на каждую локальную запись. Live hint позволяет фоновую попытку, но не доказывает server auth.
5. `syncAuth` проверяется одним общим admission path для boot, `syncNow`, `pushNow`, debounce, online, visibility, interval, retry, integrity и resync. `401` прекращает auto retries во всех путях до reauth; локальные commits продолжаются.
6. Во время обычной доступной реплики background error никогда не сбрасывает local-ready state.
7. Текст boot состояния: `Opening local data…`. `Loading your data…` использовать только для начального получения данных при отсутствии пригодной реплики. Не показывать full-screen loader на warm sync.
8. В статусе при auth pause: `Sign in to sync`, дополнительное `N changes saved on this device`; CTA ведёт в явный reauth с возможностью вернуться к local workspace. При offline + auth pause показывать обе причины, без обещания «tap to send».
9. При unknown/никогда не завершённом sync не писать `Synced`. Приоритет owner mismatch/auth required над общим outbox CTA.
10. Settings показывает имя владельца из replica metadata, не из истёкшего cookie. Серверные credential controls явно требуют входа; не вызывают retry-loop при offline.
11. Выбор профиля перенести в IDB metadata и reactive Zustand. Проверять, что ID есть среди локальных живых профилей. Invalid selection → local chooser. Same-user login сохраняет выбор, удаление профиля его инвалидирует.
12. `createProfile()` возвращает успех после local commit; выбор нового профиля не ждёт push. Сохранить UUID/ordering: profile insert должен предшествовать зависимым мутациям.
13. Найти **все** вызовы `readSelectedProfileId`, cookie guards и `selectProfile` (формы/transactions/statistics/import/settings). Перевести UI на reactive selection, mutation handlers — на captured replica/profile context.
14. Удалить network selection из client flow. Старый server endpoint/cookies можно временно оставить для deployment compatibility, но они не управляют новым local доступом. Не расширять серверную авторизацию до доверия local selection.

Проверки: expired cookies + reload/deep link/offline/edit/reload; delayed/401/503 sync не скрывает data; offline create/select profile; fresh login без данных; invalid selected profile; cancelled reauth возвращает workspace; status не врёт о доставке.

### T6. Не уничтожать рабочую реплику перед full refresh

Файлы: `src/modules/sync/sync-run.ts`, `sync-run.test.ts`, `sync-engine.ts`, `idb.ts`, integrity UI.

Причина включения в scope: после долгой паузы курсоры могут быть слишком старыми. Исправленная авторизация бесполезна, если auto recovery удаляет local rows перед неуспешной сетью.

Предпочтительная минимальная реализация для текущего размера набора данных:

1. На stale-cursor recovery и explicit resync не вызывать `clearLocalRows()` до запроса.
2. Получать paginated full replacement во временный **in-memory** набор, с собственными курсорами. UI продолжает читать старую durable replica. Не включать partial replacement в обычный Zustand.
3. Captured owner/replicaId/localRevision обязательны. Begin/end проверяют отсутствие outbox для замены; normal run сначала пытается безопасно отправить очередь, как сейчас.
4. Только после завершения всех страниц атомарно заменить replicated tables/cursors/reference metadata в одной guarded IDB transaction. Outbox и owner metadata не стирать.
5. В той же transaction ещё раз проверить пустую очередь, неизменную localRevision и identity. При новых локальных изменениях replacement не применять: сохранить старую реплику и очередь, затем обычным scheduler повторить push/rebuild позже, без tight retry-loop.
6. `401`, timeout, превышение page budget, protocol error и смена owner просто отбрасывают временный набор. Полезная local replica остаётся.
7. Для **первоначально пустой** реплики сохранить progressive hydration reference tables; это отдельная ветка, не rebuild существующих данных.
8. Если staging memory оказывается чрезмерным на измеренном объёме, остановиться с отчётом; не вводить неограниченный staging и не заменять решение ранним wipe. Persistent staging — отдельное расширение.

Проверки: stale cursor + 401/503/offline не удаляет rows; successful full replacement удаляет действительно исчезнувшие server rows атомарно; local edit во время rebuild сохраняется и отменяет swap; interrupted rebuild/reload оставляет старый пригодный workspace.

### T7. Анонимная SPA shell и статическая доставка HTML

Файлы: `vite.config.ts`, `src/routes/__root.tsx`, UI routes, `src/router.tsx`, `vite-plugins/offline-service-worker.ts`; новые route/build helper files по необходимости.

Подход: native TanStack Start SPA-shell prerendering, а не вручную написанный HTML с выдуманным hydration payload. Серверные функции и `/api/push` остаются серверными.

1. Корневой `__root.tsx` оставить анонимным document shell: static head/styles, html/body, children/outlet, Scripts. Без cookie reads, redirects, personalized context и sync startup.
2. Ввести pathless layout `_client.tsx` с `ssr: false`. Перенести туда app providers/chrome и local boot/gate из T5. **Не возвращать туда старый live-session guard.**
3. UI routes переместить под `_client` без изменения публичных URL: index, login, profile, accounts, transactions, statistics, settings, transactions-import. `/api/push` остаётся вне layout. Обновить references на route IDs и сгенерировать дерево.
4. Сохранить default Start client entry/hydration. Не подменять `hydrateRoot` на `createRoot` только ради устранения mismatch.
5. Включить SPA prerender для одного shell. Проверенная по установленному plugin API отправная конфигурация:

```ts
spa: {
  enabled: true,
  maskPath: "/",
  prerender: { outputPath: "/_shell", crawlLinks: false, retryCount: 0 },
},
prerender: {
  autoStaticPathsDiscovery: false,
  crawlLinks: false,
  failOnError: true,
},
```

6. Проверить реальную сборку: ожидаемый промежуточный artifact `dist/client/_shell.html`. Shell генерируется **после** client `writeBundle`. Финальную сборку worker перенести в plugin с `enforce: 'post'` и `buildApp: { order: 'post', handler }`, расположенный после Start. Одного `order: 'post'` недостаточно для гарантии порядка относительно Start prerender. Finalizer до завершения build выпускает versioned shell, worker, `dist/client/_redirects` и общую artifact metadata для preview; не читает ещё не существующий shell. Обновить тест T1: прямой вызов одного `writeBundle` больше не проверяет весь lifecycle. Реальным build-тестом подтвердить порядок finalization и обход preview middleware для внутренних prerender requests.
7. Генерация shell должна проходить без authenticated cookies и DB queries. Root исполняется даже в SPA shell mode; просто `if (server) return` в старом guard недостаточно — начальная hydration может не повторить его на клиенте.
8. Оставить `defaultPendingMs > 0` для client navigation; убрать искусственный minimum pending delay именно у initial client boundary (`pendingMinMs: 0` или эквивалент). Проверить, что navigating между страницами не мигает loader.
9. Получать единый content-based build ID из shell, отсортированных runtime assets, worker code и relevant protocol constants. Не `Date.now()` как единственная идентичность. Скопировать shell в `dist/client/_shell/<buildId>/index.html`; fetch URL `/_shell/<buildId>/`.
10. Прекэшировать shell и полный runtime client graph (lazy routes, CSS, charts/import), manifest/icons. Не source maps. Проверять отсутствие missing references.
11. Netlify: explicit static rewrites для известных UI paths на текущий versioned shell (200, не redirect). Не wildcard, поглощающий `/_serverFn/*`, `/api/*`, assets или отсутствующий `.js`.
12. Redirect/rewrite rules и worker navigation allowlist генерировать из одного набора UI paths. Сохранять search/hash в адресе; определить trailing-slash и unknown-path поведение.
13. Preview должен использовать ту же ограниченную rewrite policy: Netlify redirects сами по себе не исполняются `vite preview`. Preview middleware не должен перехватывать внутренние prerender requests и рекурсивно просить ещё не созданный shell.
14. Versioned shell/assets — immutable caching. `/sw.js` — revalidation, не immutable. Auth/API responses не кэшируются этим механизмом.

Обязательные gates, а не предположения: реальная сборка; shell byte content и отсутствие персонализации; hydration deep links; post-build ordering; Netlify deploy-preview rewrite precedence и API bypass. Смена версий installed Start plugin требует повторной проверки API.

### T8. Cache-first worker и безопасное обновление

Файлы: `public/sw.js`, `vite-plugins/offline-service-worker.ts`, `.test.ts`, `src/components/ServiceWorkerRegistration.tsx`; один feature-specific update notice при необходимости.

1. Для same-origin GET navigation на UI allowlist сразу вернуть shell **своего versioned cache**. Не вызывать `fetch(request)` ни до, ни параллельно ради обновления HTML.
2. Не писать route responses в cache `/`. Не использовать произвольный `caches.match('/')` для выбора документа между сборками.
3. Assets — exact-URL cache-first; отсутствующий asset не подменять HTML. API/serverFn/non-GET/foreign-origin — network-only.
4. На неожиданно missing cached shell допускается запрос только фиксированного versioned shell URL, `credentials: 'omit'`; отвергнуть redirects, не-HTML и failure. Если недоступен — небольшой anonymous offline recovery screen. Не отправляться за personalized SSR `/`.
5. Install делает полный проверенный precache перед успехом. Если недоступна хотя бы одна обязательная часть, новая версия не становится рабочей, прежняя сохраняется.
6. Удалить unconditional `skipWaiting`, автоматический `clients.claim` и reload on controllerchange. Первый визит без controller нормален: worker контролирует следующий document navigation.
7. Waiting worker → notice `Update ready. Finish your edits, then close all app windows and reopen.` Учесть waiting уже при открытии и новый updatefound.
8. Не добавлять `Update now` без координации dirty forms/import/submissions всех вкладок. `outboxCount === 0` не означает отсутствие несохранённого draft.
9. Различать active-worker build, waiting installation, completed caches и версии живых клиентов. Waiting install никогда не удаляет active cache. Сохранять как минимум текущий и предыдущий complete build, а также все builds, необходимые живым клиентам; это минимум, не жёсткий лимит в две версии. Удалять старый complete cache только после подтверждения, что он не используется. Неизвестные/uncontrolled/unresponsive clients откладывают cleanup, а не дают разрешение на eviction. Для определения версии использовать нейтральный build ID клиента и согласованный message handshake; отсутствие ответа не означает отсутствие клиента. Не обещать фиксированную верхнюю границу кэша при неопределённых live clients; отдельно очищать доказуемо ненужные незавершённые installs. Проверить A/B/C с оставшимся uncontrolled или unresponsive окном A.
10. Registration failure не блокирует приложение, но делает offline-unavailable статус видимым. `navigator.storage.persist()` запрашивать best-effort независимо от длительности sync, не обещать, что браузер обязательно сохранит данные.
11. Background outbox drain остаётся отключённым, пока отдельная зависимость ADR 0001 не гарантирует atomic canonical rows/colors/conflict-notice settlement с owner/replica fencing. Не восстанавливать acknowledgment-only deletion ради «полноты PWA».

Проверки: cached online navigation не вызывает upstream document fetch; full offline boot; no unexpected reload initial/update takeover; A/B two-tab dirty form сохранена; A/B/C cleanup не удаляет нужные старому окну assets; failed new install сохраняет A; cache eviction показывает recovery, не бесконечный белый экран.

### T9. Интеграция, документация и выпуск

Предусловие: завершены **обе** ветки — T6 и T8. Быстрая оболочка без безопасного full refresh не считается готовой интеграцией.

1. Выполнить матрицу §7 на production build в disposable окружении. Сначала targeted tests; broader typecheck/unit/lint выполнять один раз на интеграционной границе, не повторять после каждого файла.
2. Обновить `docs/architecture.md`: local/auth/transport separation, boot, SPA shell, owner protocol, local selection, same-user reauth, recovery и update policy. Не описывать планируемые механизмы как уже реализованные до проверок.
3. Обновить `docs/limitations.md`: legacy recovery, browser storage eviction, неподдерживаемые concurrency environments, отключённый background delivery, фактические perf samples.
4. В `docs/plans/offline-completeness.md` и `session-management.md` явно пометить superseded разделы ссылкой сюда. Не переписывать историю целиком.
5. Уточнить устаревшие комментарии «cache can always be wiped», «unauthorized sends to login», «profile selection must wait for server», «passkeys only» в затронутых местах.
6. Подготовить release checklist из §8 и указать, какие gates действительно пройдены. Деплой выполняется только по разрешению пользователя.

## 7. Матрица приёмки

Каждая строка — отдельный тест или явно описанная ручная проверка. Финансовые assertions проверяют IDs/значения/queue contents, а не только наличие заголовка.

| ID  | Сценарий                                                          | Критерий                                                                                                                       |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| P01 | Generated worker                                                  | Classic parse и top-level execution успешны; реальная registration успешна                                                     |
| P02 | Установленная PWA, сеть есть, document upstream удерживается 15 с | Local shell/data появляются **до освобождения запроса**; нет зависимости UI navigation от сети                                 |
| P03 | Sync/auth backend удерживается 15 с                               | Workspace открыт и локальный edit commit успешен до ответа                                                                     |
| P04 | Повторное offline открытие ранее не посещённого UI deep link      | Shell и lazy chunk найдены локально; адрес/filters сохранены                                                                   |
| P05 | Expired/missing cookies + существующая replica                    | Данные видны, edit/reload сохраняет outbox, нет forced login                                                                   |
| P06 | Реальный sync `401` после local boot                              | Workspace не исчезает, очередь не меняется, CTA reauth; timers/online/edit не создают retry storm                              |
| P07 | Timeout/503/offline                                               | Не стираются rows и не выставляется login-required только из-за transport failure                                              |
| P08 | Same-user password/passkey/autofill                               | Exact mutation IDs/seq/payload/base timestamps/cursors/selection сохраняются                                                   |
| P09 | Failed/cancelled reauth                                           | Нет reset, смены owner или потери локальных изменений                                                                          |
| P10 | Reauth A credentials B                                            | Сервер не выдаёт B cookies в expected-A flow; A очередь сохранена                                                              |
| P11 | Cookies B при replica A                                           | Все sync входы отказывают до domain reads/writes; профиль A не создаётся для B                                                 |
| P12 | Late A response после replacement и A→B→A                         | Нет чужих rows/status/cursors, удаления новой очереди или stale retry                                                          |
| P13 | Две вкладки + sleeping tab + stale form/import                    | Resume инвалидирует контекст; durable write старого draft отклоняется                                                          |
| P14 | IDB v2→v3 с outbox                                                | Нет destructive upgrade; сохраняются порядок и contents; blocked не считается успехом                                          |
| P15 | Legacy empty/unique-owner/mixed/outbox-only                       | Только доказуемое reconciliation; ambiguous не sync и не wipe; recovery export доступен                                        |
| P16 | Offline create/select profile                                     | Нет ожидания server function/push; последующая очередь упорядочена                                                             |
| P17 | Stale cursor + failing full refresh                               | Старая рабочая replica остаётся доступной                                                                                      |
| P18 | Edit во время staged refresh                                      | Новое изменение сохраняется; replacement swap отменяется                                                                       |
| P19 | Build A open dirty forms, приходит B                              | Ни одна вкладка не reload; A assets доступны; после закрытия окон открывается B                                                |
| P20 | Прерван install B / missing asset / redirected shell              | A остаётся работоспособной; B не активируется как complete cache                                                               |
| P21 | JS-disabled anonymous HTML, cookies A/B                           | Одинаковая анонимная shell, нет usernames/financial data/auth redirect payload                                                 |
| P22 | `/api/push`, `/_serverFn/*`, unknown `.js`                        | Не получают HTML SPA fallback; реальные status/content-type сохранены                                                          |
| P23 | Explicit sign-out                                                 | Durable obligations warning; failure не маскируется; success не оставляет финансовые данные/drafts для следующего пользователя |
| P24 | Empty storage, IDB unavailable, cache evicted                     | Понятные разные состояния; нет ложного offline-ready/saved/synced                                                              |
| P25 | Старый worker/client payload                                      | Fail closed до обработки; no legacy acknowledgment-only deletion через новый endpoint                                          |

### Проверка скорости

- Главный критерий — **причинная независимость**, не хрупкий лимит миллисекунд в CI: намеренно держать серверные ответы и удостовериться, что UI/локальное сохранение уже готовы.
- Для обычного warmed desktop preview записать navigation/FCP, local-read start/end, local-ready и sync start/end. Отдельно измерить первый и повторный визиты.
- Инженерный ориентир, не SLA: local workspace менее 1 с на тестовом desktop после успешного precache с репрезентативной репликой. Если больше — отчёт по фазам, не ослабление теста незаметно.
- Логи/marks без содержимого транзакций, username, tokens и payloads. Ограничить debug telemetry dev/test; не вводить постоянную production аналитику без отдельного решения.
- Для worker-owned fetch не полагаться только на `page.route()`: использовать контролируемый локальный server/proxy harness и реальные SW. Обычный `setOffline(true)` не доказывает fast-online поведение.

### Команды

Существующие команды для точечных проверок (после соответствующих изменений):

```sh
pnpm exec vitest run vite-plugins/offline-service-worker.test.ts
pnpm exec vitest run src/modules/sync/sync-run.test.ts src/modules/sync/outbox-acceptance.test.ts src/modules/sync/idb.test.ts
pnpm generate-routes
pnpm build
node --check dist/client/sw.js
pnpm test:e2e:pwa
pnpm typecheck
```

Добавленные тестовые файлы запускать по их фактическим путям. `node --check` — дополнительная проверка, не замена classic-script test. После расширения PWA script проверить, что он действительно исполняет новые specs. Изолированные protocol/IDB/browser harness тесты не должны требовать production credentials. Настоящие auth round trips — только disposable backend с настроенными test credentials, никогда prod.

## 8. Выпуск и совместимость: обязательный отдельный gate

Нельзя обещать безопасный rolling update только потому, что новая версия умеет owner checks. Старые страницы всё ещё могут вызвать `deleteDatabase()` после login, а старые worker — отправлять legacy outbox. При passive update старые страницы могут жить долго.

1. Сначала проверять в deploy preview: static shell на всех UI URLs; worker parse/install; header/rewrite precedence; serverFn/API работают; no DB work при выдаче shell.
2. Протокол нового сервера обязан отвергать старые sync envelopes без owner. Старый клиент должен получить требование обновления/ошибку, не незаметно синхронизировать under wrong identity.
3. Перед IDB v3 rollout проверить mixed-version A/B тестом, что старые открытые connections блокируют upgrade, а новая UI честно просит закрыть старые окна. Нельзя считать blocked delete/upgrade успешным.
4. Для первого перехода с текущей небезопасной версии предусмотреть **управляемый cutover**: пользователь сохраняет/экспортирует local-only obligations, затем онлайн получает новую версию worker B. Сначала подтвердить, что B успешно installed/waiting и её precache полон; после этого закрыть все старые вкладки и PWA окна, открыть приложение снова и проверить, что B — active/controller, загружена оболочка B и миграция завершилась. Первого открытия онлайн недостаточно: старый worker может отдать A и только затем обнаружить B, поэтому может потребоваться ещё один полный close/reopen. Проверить переход как со старым рабочим worker, так и без registration; failure регистрации блокирует cutover. Не просить очищать site data/unregister с потерей IndexedDB.
5. Если требуется бесшовный rollout на неизвестное количество устройств без возможности закрыть старые версии, **остановиться перед релизом**: нужен отдельный compatibility/bridge release или изолированное новое storage namespace с проверяемым переносом. Не считать client-side mutex защитой от уже выпущенного кода, который этот mutex не использует.
6. Проверить возврат из offline с устаревшим клиентом: данные остаются, sync fail closed, есть путь обновления без reset. Проверить совместимость RPC identifiers, а не только JSON schema.
7. Не откатывать клиент на старый destructive IDB upgrade/login-reset код после v3 migration. Rollback — сохранение нового storage/owner protocol с forward fix UI/worker; старый backend нельзя вернуть, если он снова принимает unsafe legacy pushes.
8. На реальном iOS/Safari installed PWA проверить close/reopen, expiry, offline edit и обновление. Chromium E2E не доказывает OS lifecycle других браузеров.
9. После деплоя анонимно повторить worker registration + Cache Storage + first/repeat navigation measurement. Авторизованную проверку проводить пользователю или отдельному разрешённому test identity, не создавать prod users автоматически.

### Зависимость ADR 0001

Текущий код не полностью реализует durable conflict notices/единый settlement, описанные в ADR 0001. Эта работа не должна превращаться в скрытую реализацию всего conflict inbox.

- Не ухудшать существующий foreground settlement и сохранность outbox.
- Сохранять имеющиеся durable notices при миграции/reauth, если они появятся в основной ветке до исполнения плана.
- Background worker delivery оставлять отключённым, пока ADR 0001 не реализован и не адаптирован к owner/replica fencing. Это явное временное ограничение, не завершённая реализация Background Sync.
- Если при интеграции нельзя гарантировать сохранность существующего foreground settlement, выделить blocking task на правильный settlement seam; не удалять entries раньше ради зелёных тестов.

## 9. Definition of done

- [ ] ADR 0003 реализован: expiry не запрещает local просмотр/изменения.
- [ ] Worker на свежем production build действительно регистрируется и кэширует полную анонимную оболочку.
- [ ] Warm online/offline запуск не ждёт сервер; initial bootstrap честно отличается от local boot.
- [ ] Same-user reauth сохраняет exact obligations; expected-owner protocol защищает все sync входы.
- [ ] Миграция и delayed callbacks не теряют и не смешивают данные.
- [ ] Выбор/создание профиля локальны; stale-replica recovery не стирает рабочий набор до успешной замены.
- [ ] Обновления не перезагружают dirty формы; failed install сохраняет рабочую версию.
- [ ] Background delivery либо безопасно реализован по ADR 0001, либо явно отключён и задокументирован.
- [ ] Матрица приёмки имеет реальные результаты; непройденные browser/deploy gates перечислены, не объявлены успешными.
- [ ] Cutover/rollback проверены или выпуск заблокирован до выполнения явно указанных шагов.
- [ ] Документация соответствует реализованному состоянию; тестовые credentials и финансовые артефакты не попали в repo.

## 10. Готовый запрос для следующей модели

> Прочитай `AGENTS.md`, `CONTEXT.md`, ADR 0001–0003 и `docs/plans/local-first-pwa-startup.md`. Реализуй ближайшую незавершённую задачу T0–T9, соблюдая зависимости; не пытайся закрыть весь план одним изменением. Начни с фактического состояния репозитория и failing regression test. Не удаляй local replica/outbox ради исправления auth, migration или worker update. Не ослабляй expected-owner checks и не включай acknowledgment-only background push. Не читай `.env*`, не используй production для изменяющих тестов, не коммить и не деплой без разрешения. В конце укажи изменённые файлы, реально выполненные проверки, незавершённые критерии и следующую задачу. Если требуется неподтверждённый API, unsafe migration или обход release gate — остановись с конкретным вопросом, а не угадывай.
