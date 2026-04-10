# elibrary-RSCI-to-BibTex

Userscript для [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=ru), который извлекает BibTeX из публикаций [elibrary.ru](https://www.elibrary.ru/).

## Безопасный режим работы

Скрипт больше не делает массовый автоматический обход публикаций со страниц списков.

Данные попадают в локальную коллекцию только когда вы вручную открываете страницу статьи:
- `https://elibrary.ru/item.asp?id=...`
- короткие EDN-ссылки вида `https://elibrary.ru/xbqsak`

## Что сохраняется в localStorage

Для каждой обработанной публикации сохраняется запись (с обновлением без дублей):
- `publicationId` (если есть)
- `edn` (если есть)
- `sourceUrl`
- `bibtex`
- `title`
- `year`
- `updatedAt`
- `abstract` (опционально)

## Аннотация (abstract)

В начале `elibrary-RSCI-to-BibTex.user.js` есть флаг:

```js
const STORE_ABSTRACT = true;
```

- `true` — сохранять abstract (если найден на странице статьи)
- `false` — не сохранять abstract

## Экспорт коллекции

На страницах eLIBRARY отображается панель скрипта с кнопкой `Экспорт JSON`.
Кнопка выгружает всю локальную коллекцию в JSON-файл.

## Пометки ссылок на статьи

Скрипт проходит по ссылкам на статьи и добавляет CSS-классы:
- `bibtex-processed` — запись уже есть в локальной базе
- `bibtex-unprocessed` — записи ещё нет

По умолчанию для обработанных ссылок добавляется небольшой маркер `✓`.

## По одной статье

На странице публикации скрипт, как и раньше:
- показывает BibTeX-блок
- позволяет копировать BibTeX кнопкой
- поддерживает горячую клавишу `Ctrl+B`
