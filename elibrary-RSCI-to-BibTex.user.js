// ==UserScript==
// @name         elibrary-RSCI-to-BibTex
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Elibrary (Russian Science Citation Index) to BibTex article citation
// @author       You
// @match        https://*elibrary.ru/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tampermonkey.net
// @grant        none
// ==/UserScript==


// Конфигурация пользователем //

// Добавить общий префикс к идентификатору всех публикаций
const ENTRY_ID_PREFIX = '';
// const ENTRY_ID_PREFIX = 'own_';

// Сохранять abstract (аннотацию статьи) в локальную коллекцию (если найден на странице статьи)
const STORE_ABSTRACT = true;

// Нормализовывать регистр авторов/заголовков/журналов (оставляя аббревиатуры)
const NORMALIZE_CASE_FIELDS = true;
const KNOWN_CYRILLIC_ABBREVIATIONS = new Set([
    'РАН', 'РФ', 'СССР', 'США', 'ООН',
    'МГУ', 'СПБГУ', 'ВАК', 'УДК', 'ЭВМ',
    'АСУ', 'ИТ', 'ИИ', 'БД', 'БЗ', 'РИНЦ',
]);




// ↓ Внутренние определения ↓

// Может быть переопределён как 'https://www.elibrary.ru'
let ELIBRARY_DOMAIN = 'https://elibrary.ru';

const translit_data = {
    "А":"A", "а":"a", "Б":"B", "б":"b", "В":"V", "в":"v", "Г":"G", "г":"g", "Д":"D", "д":"d",
    "Е":"E", "е":"e", "Ж":"ZH", "ж":"zh", "З":"Z", "з":"z", "И":"I", "и":"i", "Й":"I", "й":"i",
    "К":"K", "к":"k", "Л":"L", "л":"l", "М":"M", "м":"m", "Н":"N", "н":"n", "О":"O", "о":"o",
    "П":"P", "п":"p", "Р":"R", "р":"r", "С":"S", "с":"s", "Т":"T", "т":"t", "У":"U", "у":"u",
    "Ф":"F", "ф":"f", "Х":"H", "х":"h", "Ц":"TS", "ц":"ts", "Ч":"CH", "ч":"ch", "Ш":"SH", "ш":"sh",
    "Щ":"SCH", "щ":"sch", "Ъ":"_", "ъ":"_", "Ы":"Y", "ы":"y", "Ь":"_", "ь":"_", "Э":"E", "э":"e",
    "Ю":"YU", "ю":"yu", "Я":"Ya", "я":"ya", "Ё":"E", "ё":"e",
};

function transliterate(word) {
    return word.split('').map(function (char) {
        return translit_data[char] || char;
    }).join("");
}

function min_string(a, b) {
    return a < b ? a : b;
}

const BIBTEX_COLLECTION_STORAGE_KEY = 'elibrary_bibtex_collection_v1';
const LINK_MARKER_STYLE_ID = 'elibrary-bibtex-link-markers';
const PAGE_TOOLBAR_ID = 'elibrary-bibtex-toolbar';

class CollectedBibtexStore {
    static emptyStorageShape() {
        return {
            version: 1,
            recordsByKey: {},
            indexByPublicationId: {},
            indexByEdn: {},
        };
    }

    static loadRaw() {
        const rawValue = localStorage.getItem(BIBTEX_COLLECTION_STORAGE_KEY);
        if (!rawValue) {
            return this.emptyStorageShape();
        }

        try {
            const parsed = JSON.parse(rawValue);
            return {
                version: 1,
                recordsByKey: parsed.recordsByKey || {},
                indexByPublicationId: parsed.indexByPublicationId || {},
                indexByEdn: parsed.indexByEdn || {},
            };
        } catch (error) {
            console.error('Failed to parse BibTeX collection from localStorage:', error);
            return this.emptyStorageShape();
        }
    }

    static saveRaw(raw) {
        localStorage.setItem(BIBTEX_COLLECTION_STORAGE_KEY, JSON.stringify(raw));
    }

    static normalizeEdn(edn) {
        return (edn || '').trim().toLowerCase();
    }

    static makeRecordKey(publicationId, edn, sourceUrl) {
        if (publicationId) {
            return `id:${publicationId}`;
        }
        if (edn) {
            return `edn:${this.normalizeEdn(edn)}`;
        }
        return `url:${sourceUrl || ''}`;
    }

    static upsert(record) {
        const raw = this.loadRaw();
        const publicationId = (record.publicationId || '').trim();
        const edn = this.normalizeEdn(record.edn || '');
        const sourceUrl = record.sourceUrl || '';

        const candidateKeys = [
            publicationId ? raw.indexByPublicationId[publicationId] : null,
            edn ? raw.indexByEdn[edn] : null,
        ].filter(Boolean);
        const existingKey = candidateKeys.find((key) => !!raw.recordsByKey[key]);
        const recordKey = existingKey || this.makeRecordKey(publicationId, edn, sourceUrl);
        const oldRecord = raw.recordsByKey[recordKey] || {};

        const nextRecord = {
            ...oldRecord,
            ...record,
            publicationId,
            edn,
            sourceUrl,
            updatedAt: new Date().toISOString(),
        };

        raw.recordsByKey[recordKey] = nextRecord;
        if (publicationId) {
            raw.indexByPublicationId[publicationId] = recordKey;
        }
        if (edn) {
            raw.indexByEdn[edn] = recordKey;
        }

        this.saveRaw(raw);
        return nextRecord;
    }

    static has(target) {
        const raw = this.loadRaw();
        if (target.publicationId && raw.indexByPublicationId[target.publicationId]) {
            return true;
        }
        const normalizedEdn = this.normalizeEdn(target.edn || '');
        if (normalizedEdn && raw.indexByEdn[normalizedEdn]) {
            return true;
        }
        return false;
    }

    static getAllRecords() {
        const raw = this.loadRaw();
        return Object.values(raw.recordsByKey).sort((a, b) => {
            return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
    }

    static getCount() {
        return this.getAllRecords().length;
    }

    static exportJson() {
        const records = this.getAllRecords();
        return JSON.stringify({
            exportedAt: new Date().toISOString(),
            count: records.length,
            records,
        }, null, 2);
    }

    static exportBibtex() {
        const records = this.getAllRecords();
        const bibtexEntries = records
            .map((record) => String(record.bibtex || '').trim())
            .filter((value) => !!value);
        return bibtexEntries.join('\n\n');
    }

    static downloadContent(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = blobUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(blobUrl);
    }

    static downloadJson() {
        const datePart = new Date().toISOString().slice(0, 10);
        const jsonContent = this.exportJson();
        this.downloadContent(`elibrary-bibtex-${datePart}.json`, jsonContent, 'application/json;charset=utf-8');
    }

    static downloadBibtex() {
        const datePart = new Date().toISOString().slice(0, 10);
        const bibtexContent = this.exportBibtex();
        this.downloadContent(`elibrary-bibtex-${datePart}.bib`, bibtexContent, 'text/x-bibtex;charset=utf-8');
    }
}

function parseArticleLinkTarget(urlLike) {
    let parsedUrl;
    try {
        parsedUrl = new URL(urlLike, window.location.origin);
    } catch (_) {
        return null;
    }

    if (!parsedUrl.host.includes('elibrary.ru')) {
        return null;
    }

    if (parsedUrl.pathname === '/item.asp') {
        const publicationId = (parsedUrl.searchParams.get('id') || '').trim();
        const edn = (parsedUrl.searchParams.get('edn') || '').trim().toLowerCase();
        if (!publicationId && !edn) {
            return null;
        }
        return {
            publicationId,
            edn,
            sourceUrl: parsedUrl.href,
        };
    }

    const shortPathMatch = parsedUrl.pathname.match(/^\/([a-z0-9]{6})$/i);
    if (shortPathMatch && !parsedUrl.search) {
        return {
            publicationId: '',
            edn: shortPathMatch[1].toLowerCase(),
            sourceUrl: parsedUrl.href,
        };
    }

    return null;
}

function ensureLinkMarkerStyles() {
    if (document.getElementById(LINK_MARKER_STYLE_ID)) {
        return;
    }

    const style = document.createElement('style');
    style.id = LINK_MARKER_STYLE_ID;
    style.innerHTML = `
        a.bibtex-processed {
            color: #1a7f37 !important;
        }
        a.bibtex-processed::after {
            content: ' ✓';
            color: #218838;
            font-weight: bold;
        }
        a.bibtex-unprocessed {
            color: #b54708 !important;
            opacity: 0.95;
        }
    `;
    document.head.appendChild(style);
}

function markKnownArticleLinks() {
    ensureLinkMarkerStyles();

    const links = document.querySelectorAll('a[href]');
    for (const link of links) {
        const target = parseArticleLinkTarget(link.href);
        if (!target) {
            continue;
        }

        const saved = CollectedBibtexStore.has(target);
        link.classList.remove('bibtex-processed', 'bibtex-unprocessed');
        link.classList.add(saved ? 'bibtex-processed' : 'bibtex-unprocessed');
    }
}

function ensureToolbar() {
    if (document.getElementById(PAGE_TOOLBAR_ID)) {
        return;
    }

    const toolbar = document.createElement('div');
    toolbar.id = PAGE_TOOLBAR_ID;
    toolbar.style.margin = '12px 0';
    toolbar.style.padding = '8px 10px';
    toolbar.style.border = '1px solid #ddd';
    toolbar.style.backgroundColor = '#fafafa';
    toolbar.style.fontSize = '12px';

    const exportButton = document.createElement('button');
    exportButton.innerText = 'Экспорт JSON';
    exportButton.style.marginRight = '10px';
    exportButton.addEventListener('click', () => {
        CollectedBibtexStore.downloadJson();
    });

    const exportBibtexButton = document.createElement('button');
    exportBibtexButton.innerText = 'Экспорт BibTeX';
    exportBibtexButton.style.marginRight = '10px';
    exportBibtexButton.addEventListener('click', () => {
        CollectedBibtexStore.downloadBibtex();
    });

    const counter = document.createElement('span');
    counter.innerText = `Записей в локальной базе: ${CollectedBibtexStore.getCount()}`;

    toolbar.appendChild(exportButton);
    toolbar.appendChild(exportBibtexButton);
    toolbar.appendChild(counter);

    if (document.body.firstChild) {
        document.body.insertBefore(toolbar, document.body.firstChild);
    } else {
        document.body.appendChild(toolbar);
    }
}

function divide_authors_info(authors_raw_list) {
    function isNumeric(num) {
        return !isNaN(num);
    }

    let authors = [];
    let affiliations = [];

    if (!authors_raw_list.some(author_value => isNumeric(author_value))) {
        return [authors_raw_list, affiliations];
    }

    const max_index = authors_raw_list.length - 1;
    let affiliations_start = max_index;
    let last_author;

    for (let i = 0; i <= max_index; i++) {
        const s = authors_raw_list[i];

        if (i === 0) {
            last_author = s;
            authors.push(s);
            continue;
        }
        if (isNumeric(s)) {
            for (let j = max_index - 1; j > i; j--) {
                if (+s === +authors_raw_list[j]) {
                    affiliations.push([last_author, authors_raw_list[j + 1]]);
                    affiliations_start = Math.min(affiliations_start, j + 1);
                    break;
                }
            }
        } else if (i >= affiliations_start) {
            break;
        } else {
            last_author = s;
            authors.push(s);
        }
    }

    return [authors, affiliations];
}

function extractAbstractFromTables(tables, baseIndexShift, doc) {
    // Fast path for common eLIBRARY structure:
    // <div id="abstract1"> ... </div>, <div id="abstract2"> ... </div>, ...
    const directAbstractDiv = [...doc.querySelectorAll('div[id]')]
        .find((node) => /^abstract\d*$/i.test(node.id || ''));
    const directAbstractText = (directAbstractDiv?.innerText || '').trim();
    if (directAbstractText) {
        return directAbstractText;
    }

    const abstractIndexes = [baseIndexShift + 29, baseIndexShift + 30];
    for (const index of abstractIndexes) {
        const table = tables[index];
        if (!table) {
            continue;
        }
        const tdList = table.querySelectorAll('td');
        if (tdList.length < 3) {
            continue;
        }
        const caption = (tdList[0].innerText || '').trim().toUpperCase();
        if (!caption.includes('АННОТАЦИЯ')) {
            continue;
        }
        const abstractText = (tdList[2].innerText || '').trim();
        if (abstractText) {
            return abstractText;
        }
    }

    const fallbackCell = Array.from(doc.querySelectorAll('td')).find((cell) => {
        const value = (cell.innerText || '').trim().toUpperCase();
        return value === 'АННОТАЦИЯ:';
    });
    if (!fallbackCell) {
        return '';
    }

    // 1) Same-row extraction (older layout)
    if (fallbackCell.parentElement) {
        const cells = fallbackCell.parentElement.querySelectorAll('td');
        if (cells.length >= 3) {
            const sameRowText = (cells[2].innerText || '').trim();
            if (sameRowText) {
                return sameRowText;
            }
        }
    }

    // 2) Next-row extraction inside the same section table (current layout)
    const abstractSectionTable = fallbackCell.closest('table');
    if (abstractSectionTable) {
        const valueCell = abstractSectionTable.querySelector('tr:nth-child(2) td:last-child');
        const sectionText = (valueCell?.innerText || '').trim();
        if (sectionText) {
            return sectionText;
        }
    }

    return '';
}

function normalizeLabelText(value) {
    return String(value || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/:$/, '')
        .trim();
}

function toCapitalizedWord(word) {
    if (!word) {
        return word;
    }
    const lower = word.toLocaleLowerCase('ru-RU');
    return lower[0].toLocaleUpperCase('ru-RU') + lower.slice(1);
}

function isServiceWordUpper(word) {
    return [
        'И', 'ИЛИ', 'А', 'НО',
        'В', 'ВО', 'НА', 'НАД', 'ПОД', 'ПРИ',
        'ПО', 'К', 'КО', 'У', 'С', 'СО',
        'О', 'ОБ', 'ОБО', 'ДЛЯ', 'ОТ', 'ДО', 'ИЗ',
    ].includes(word);
}

function isProtectedAbbreviation(word) {
    if (!word || word !== word.toUpperCase()) {
        return false;
    }
    // Keep uppercase latin abbreviations (HTML, CSS, SQL, IT, AI, ...).
    if (/^[A-Z0-9]{2,8}$/.test(word)) {
        return true;
    }
    // Keep dotted initials/abbreviations.
    if (/^[A-ZА-ЯЁ](\.[A-ZА-ЯЁ])+\.?$/.test(word)) {
        return true;
    }
    // Keep only known cyrillic abbreviations (avoid false positives like "НАУК").
    if (/^[А-ЯЁ]{2,8}$/.test(word) && KNOWN_CYRILLIC_ABBREVIATIONS.has(word)) {
        return true;
    }
    return false;
}

function normalizeCasePreservingAbbreviations(text, sentenceCase = false) {
    if (!NORMALIZE_CASE_FIELDS) {
        return text || '';
    }
    const source = String(text || '');
    const wordRegex = /[A-Za-zА-ЯЁ]+(?:-[A-Za-zА-ЯЁ]+)*/g;

    if (!sentenceCase) {
        return source.replace(wordRegex, (word) => {
            if (isProtectedAbbreviation(word)) {
                return word;
            }
            const isUpper = word === word.toUpperCase();
            if (!isUpper) {
                return word;
            }
            return toCapitalizedWord(word);
        });
    }

    let result = '';
    let lastIndex = 0;
    let shouldCapitalizeNext = true;
    let match;

    while ((match = wordRegex.exec(source)) !== null) {
        const between = source.slice(lastIndex, match.index);
        result += between;
        if (between.includes('. ')) {
            shouldCapitalizeNext = true;
        }

        const word = match[0];
        if (isProtectedAbbreviation(word)) {
            result += word;
        } else {
            const lowered = word.toLocaleLowerCase('ru-RU');
            result += shouldCapitalizeNext ? toCapitalizedWord(lowered) : lowered;
        }

        shouldCapitalizeNext = false;
        lastIndex = wordRegex.lastIndex;
    }

    result += source.slice(lastIndex);
    return result;
}

function normalizeAuthorDisplayName(authorRaw) {
    const author = String(authorRaw || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!author || !NORMALIZE_CASE_FIELDS) {
        return author;
    }

    const initialsMatch = author.match(/^(.+?)\s+([A-ZА-ЯЁ]\.[A-ZА-ЯЁ]\.)$/);
    if (initialsMatch) {
        const surnameRaw = initialsMatch[1];
        const initials = initialsMatch[2].toUpperCase();
        const surname = surnameRaw
            .split('-')
            .map((part) => toCapitalizedWord(part))
            .join('-');
        return `${surname} ${initials}`;
    }

    return normalizeCasePreservingAbbreviations(author, false);
}

function isLikelyPersonName(value) {
    const text = String(value || '').replace(/\u00A0/g, ' ').trim();
    return /^[А-ЯЁA-Z][А-ЯЁA-Z-]+\s+[А-ЯЁA-Z]\.[А-ЯЁA-Z]\.$/.test(text);
}

function hasCyrillic(value) {
    return /[А-Яа-яЁё]/.test(String(value || ''));
}

function hasLatin(value) {
    return /[A-Za-z]/.test(String(value || ''));
}

function extractAuthorsFallback(doc, preferredLanguage = '') {
    const englishSectionLabel = [...doc.querySelectorAll('font')]
        .find((node) => normalizeLabelText(node.innerText).includes('ОПИСАНИЕ НА АНГЛИЙСКОМ ЯЗЫКЕ'));
    const englishSectionTable = englishSectionLabel?.closest('table');

    const authorNodes = [...doc.querySelectorAll('font[color="#00008f"], span.help.pointer font, b font[color="#00008f"]')]
        .filter((node) => {
            if (!englishSectionTable) {
                return true;
            }
            // Keep only nodes that appear before the English section block.
            return !!(node.compareDocumentPosition(englishSectionTable) & Node.DOCUMENT_POSITION_FOLLOWING);
        });

    const candidates = authorNodes
        .map((node) => String(node.innerText || '').replace(/\s+/g, ' ').trim())
        .filter((value) => isLikelyPersonName(value));

    const unique = [];
    const seen = new Set();
    for (const candidate of candidates) {
        if (!seen.has(candidate)) {
            seen.add(candidate);
            unique.push(candidate);
        }
    }
    if (preferredLanguage === 'russian') {
        const ruOnly = unique.filter((value) => hasCyrillic(value) && !hasLatin(value));
        return ruOnly.length > 0 ? ruOnly : unique;
    }

    if (preferredLanguage === 'english') {
        const enOnly = unique.filter((value) => hasLatin(value) && !hasCyrillic(value));
        return enOnly.length > 0 ? enOnly : unique;
    }

    return unique;
}

function extractSourceFallback(doc) {
    const sourceLabel = [...doc.querySelectorAll('font')]
        .find((node) => {
            const label = normalizeLabelText(node.innerText);
            return label.includes('ИСТОЧНИК') || label.includes('ЖУРНАЛ');
        });
    if (!sourceLabel) {
        return { journal: '', publisher: '' };
    }

    const sourceTable = sourceLabel.closest('table');
    if (!sourceTable) {
        return { journal: '', publisher: '' };
    }

    const nextTd = sourceTable.querySelector('tr:nth-child(2) td:nth-child(2)');
    const sourceAnchor = nextTd?.querySelector('a');
    const journal = sourceAnchor?.innerText?.trim() || '';

    let publisher = '';
    const text = nextTd?.innerText || '';
    const publisherMatch = text.match(/Издательство:\s*([^\n]+)/i);
    if (publisherMatch) {
        publisher = publisherMatch[1].trim();
    }

    return { journal, publisher };
}

function extractUrlsFallback(doc) {
    const anchors = [...doc.querySelectorAll('a[href]')];
    const articleUrl = anchors.find((a) => /\/item\.asp\?id=\d+/i.test(a.getAttribute('href') || ''))?.href || '';
    const ednUrl = anchors.find((a) => /^\/[a-z0-9]{6}$/i.test(a.getAttribute('href') || ''))?.href || '';
    return {
        idUrl: articleUrl,
        ednUrl,
    };
}

class ElibraryPublicationMetadata {
    constructor(url, doi, title, authors, affiliations, type, language, volume, number, year, pages, journal, abstract, publisher, holder, reqnumber, publdate, regdate, prnumber) {
        this._url = url || '';
        this._doi = doi || '';
        this._title = title || '';
        this._authors = authors || '';
        this._affiliations = affiliations || '';
        this._type = type || '';
        this._language = language || '';
        this._volume = volume || '';
        this._number = number || '';
        this._year = year || '';
        this._pages = pages || '';
        this._journal = journal || '';
        this._abstract = abstract || '';
        this._publisher = publisher || '';
        this._holder = holder || '';
        this._reqnumber = reqnumber || '';
        this._publdate = publdate || '';
        this._regdate = regdate || '';
        this._prnumber = prnumber || '';
    }

    /** method
    */
    get_bibtex_entry() {
        const metadata = this;
        let bibtexEntry;

        if (metadata._type.includes('конференци') || metadata._type.includes('тезисы доклада')) {
            bibtexEntry = BibTexConferenceEntry.from_elibrary(metadata).get();
        } else if (metadata._type.includes('статья в сборнике статей')) {
            bibtexEntry = BibTexCollectionEntry.from_elibrary(metadata).get();
        } else if (metadata._type.includes('журнал')) {
            bibtexEntry = BibTexArticleEntry.from_elibrary(metadata).get();
        } else if (metadata._type.includes('свидетельство о государственной регистрации')) {
            bibtexEntry = BibTexPatentProgramEntry.from_elibrary(metadata).get();
        } else {
            console.log('Kind of the publication cannot be recognized!!! —', metadata._type);
            bibtexEntry = null;
        }
        return bibtexEntry;
    }

    /**
    * @param[in|out] metadata object
    */
    static recognize_urls_table(table_element, metadata) {
        // eLIBRARY ID: … , EDN: … , (optional) DOI: …
        if (!table_element) {
            return;
        }
        let value_tags = table_element.querySelectorAll('font');

        value_tags.forEach((tag) => {
            let kind = tag.previousSibling?.data?.trim();
            let href = tag.children[0]?.href;
            if (!kind || !href) {
                return;
            }
            if (kind.includes('ID')) {
                // Keep plain old URL is EDN is not provided
                metadata._url = href;
            } else if (kind.includes('EDN')) {
                // Overwrite longer ID-based url with shorter EDN-based url
                metadata._url = href;
            } else if (kind.includes('DOI')) {
                metadata._doi = tag.innerText;
            } else {
                console.log('Not recognized url: ', kind, tag.innerText);
            }
        });
    }

    /**
    * @param[in|out] metadata object
    */
    static recognize_biblio_metadata_table(root_element, metadata) {
        if (!root_element) {
            return;
        }
        let value_tags = [...root_element.querySelectorAll('a, font')];

        value_tags.map(n => [n.previousSibling?.data?.trim(), n.innerText]).forEach(([kind, value]) => {
            if (!kind) {
                return;  // Skip inappropriate element.
            }

            kind = normalizeLabelText(kind);  // &nbsp; → space, trim, remove trailing ':'
            value = String(value || '').trim();

            if (kind.includes('Тип')) {
                metadata._type = value;
            } else if (kind.includes('Язык программирования')) {
                ;  // skip
            } else if (kind.includes('Номер свидетельства')) {
                metadata._prnumber = value;
            } else if (kind.includes('Номер заявки')) {
                metadata._reqnumber = value;
            } else if (kind.includes('Правообладател')) {
                metadata._holder = value.trim();
            } else if (kind.includes('Дата регистрации')) {
                metadata._regdate = value;
            } else if (kind.includes('Дата публикации')) {
                metadata._publdate = value;

            } else if (kind.includes('Язык')) {
                // russian, english
                let lang = {'русский': 'russian', 'английский': 'english'}[value] || value;
                metadata._language = lang;
            } else if (kind.includes('Том')) {
                metadata._volume = value;
            } else if (kind.includes('Номер')) {
                metadata._number = value;
            } else if (kind.includes('Год')) {
                metadata._year = value;
            } else if (kind.includes('Страницы')) {
                metadata._pages = value;
            } else if (kind.includes('eLIBRARY ID') || kind.includes('EDN') || kind.includes('DOI')) {
                // URL markers, not bibliographic fields.
                return;
            } else {
                // Silently ignore unsupported fields to avoid noisy console logs.
            }
        });
    }

    static parse(document) {
        try {
            let metadata = new ElibraryPublicationMetadata();

            let tables = document.querySelectorAll('table');
            let di = -2;

            const urls_table = tables[di + 24];
            ElibraryPublicationMetadata.recognize_urls_table(urls_table, metadata);

            metadata._title = tables[di + 25]?.querySelector('.bigtext')?.innerText || '';

            let authors_raw_list = [];
            for (let author of (tables[di + 26]?.querySelectorAll('font') || [])) {
                authors_raw_list.push(author.innerText);
            }
            if (authors_raw_list.length > 0) {
                [metadata._authors, metadata._affiliations] = divide_authors_info(authors_raw_list);
            }

            const bibl_meta_table = tables[di + 27];
            ElibraryPublicationMetadata.recognize_biblio_metadata_table(bibl_meta_table, metadata);
            // Fallback for pages where table offsets differ (e.g., review articles).
            if (!metadata._type || !metadata._year || !metadata._pages) {
                ElibraryPublicationMetadata.recognize_biblio_metadata_table(document, metadata);
            }

            const journal_table = tables[di + 28];
            const table_caption = journal_table?.querySelector('td font')?.innerText || '';
            if (table_caption.includes('ЖУРНАЛ') || table_caption.includes('ИСТОЧНИК')) {

                metadata._journal = journal_table.querySelector('a')?.innerText || '';

                let publisher = journal_table.querySelectorAll('tr')[1]?.querySelector('td font');
                if (publisher && publisher.previousSibling?.data?.trim()?.includes('Издательство')) {
                    metadata._publisher = publisher.innerText;
                }
            }

            metadata._abstract = extractAbstractFromTables(tables, di, document);

            // Fallback for pages where table indexing shifts significantly.
            if (!metadata._title) {
                metadata._title = document.querySelector('.bigtext')?.innerText?.trim() || '';
            }

            if (!Array.isArray(metadata._authors) || metadata._authors.length === 0 || !isLikelyPersonName(metadata._authors[0])) {
                const fallbackAuthors = extractAuthorsFallback(document, metadata._language);
                if (fallbackAuthors.length > 0) {
                    metadata._authors = fallbackAuthors;
                }
            }

            const fallbackUrls = extractUrlsFallback(document);
            if (!metadata._url) {
                metadata._url = fallbackUrls.ednUrl || fallbackUrls.idUrl || '';
            } else if (!/\/[a-z0-9]{6}$/i.test(new URL(metadata._url, ELIBRARY_DOMAIN).pathname) && fallbackUrls.ednUrl) {
                // Prefer short EDN url when available.
                metadata._url = fallbackUrls.ednUrl;
            }

            if (!metadata._journal || !metadata._publisher) {
                const source = extractSourceFallback(document);
                if (!metadata._journal && source.journal) {
                    metadata._journal = source.journal;
                }
                if (!metadata._publisher && source.publisher) {
                    metadata._publisher = source.publisher;
                }
            }

            return metadata;
        } catch (e) {
            console.log('Exception in ElibraryPublicationMetadata.parse:');
            console.error(e);
            return null;
        }
    }
}

class BibTexEntry {
    constructor(author, title, year, url, doi, language, publisher, abstract = '') {
        this._author = author || '';
        this._title = normalizeCasePreservingAbbreviations(title || '', true);
        this._year = year || '';
        this._url = url || '';
        this._doi = doi || '';
        this._language = language || '';
        this._publisher = normalizeCasePreservingAbbreviations(publisher || '', false);
        this._abstract = abstract || '';
    }

    get_id() {
        const author = this._author[0];
        let author_surname = min_string(author.split(' ')[0], author.split(' ')[0]) // Ordinary space (32) or &nbsp; (160)
        author_surname = transliterate(author_surname);
        // Add authors count – 1 for publications with several authors.
        const et_al = (this._author.length > 1) ? `_and${this._author.length - 1}_` : '';
        // Add 1st word from title.
        let title_1st_word = min_string(this._title.split(' ')[0], this._title.split(' ')[0])
        title_1st_word = transliterate(title_1st_word);
        return `${ENTRY_ID_PREFIX}${author_surname}${et_al}${this._year}_${title_1st_word}`;
    }

    get_field(field_name, value = null, outcommented = false) {
        if (value === null) {
            value = this['_' + field_name];
        }
        if (value) {
            return `${outcommented ? '%' : ' '}   ${field_name} = {${value}}`;
        }
        return '';
    }

    get_authors_formatted() {
        return this._author
            .map((author) => normalizeAuthorDisplayName(author))
            .map((author) => author.replace(' ', ', '))
            .map((author) => `{${author}}`)
            .join(' and ');
    }

    get_fields() {
        return [
            this.get_field('author', this.get_authors_formatted()),
            this.get_field('title'),
            this.get_field('year'),
            this.get_field('doi'),
            this.get_field('url', null, !!this._doi),  // add URL explicitly only when DOI is absent.
            this.get_field('language'),
            this.get_field('publisher'),
            this.get_field('abstract'),
        ];
    }

    get() {
        let entry = `@${this.get_entry_type()}{${this.get_id()},\n`;
        entry += this.get_fields().filter(s => !!s).join(',\n')
        entry += '\n}';
        return entry;
    }

    get_entry_type() {
        return 'article'; // По умолчанию; переопределяется в дочерних классах
    }
}

class BibTexArticleEntry extends BibTexEntry {
    constructor(author, title, journal, year, volume, number, pages, url, doi, language, publisher, abstract = '') {
        super(author, title, year, url, doi, language, publisher, abstract);
        this._journal = normalizeCasePreservingAbbreviations(journal || '', true);
        this._volume = volume || '';
        this._number = number || '';
        this._pages = pages || '';
    }

    static from_elibrary(elibrary_article) {
        return new BibTexArticleEntry(
            elibrary_article._authors,
            elibrary_article._title,
            elibrary_article._journal,
            elibrary_article._year,
            elibrary_article._volume,
            elibrary_article._number,
            elibrary_article._pages,
            elibrary_article._url,
            elibrary_article._doi,
            elibrary_article._language,
            elibrary_article._publisher,
            STORE_ABSTRACT ? elibrary_article._abstract : '',
        );
    }

    get_fields() {
        return super.get_fields().concat([
                    this.get_field('journal'),
                    this.get_field('volume'),
                    this.get_field('number'),
                    this.get_field('pages'),
                ]);
    }
}

class BibTexConferenceEntry extends BibTexEntry {
    constructor(author, title, booktitle, year, pages, url, doi, language, publisher, abstract = '') {
        super(author, title, year, url, doi, language, publisher, abstract);
        this._booktitle = normalizeCasePreservingAbbreviations(booktitle || '', true);
        this._pages = pages || '';
    }

    static from_elibrary(elibrary_article) {
        return new BibTexConferenceEntry(
            elibrary_article._authors,
            elibrary_article._title,
            elibrary_article._journal, // Используем journal как booktitle для конференций
            elibrary_article._year,
            elibrary_article._pages,
            elibrary_article._url,
            elibrary_article._doi,
            elibrary_article._language,
            elibrary_article._publisher,
            STORE_ABSTRACT ? elibrary_article._abstract : '',
        );
    }

    get_entry_type() {
        return 'inproceedings';
    }

    get_fields() {
        return super.get_fields().concat([
                    this.get_field('booktitle'),
                    this.get_field('pages'),
                    // this.get_field('volume'),
                    // this.get_field('number'),
                ]);
    }
}

class BibTexCollectionEntry extends BibTexConferenceEntry {
    static from_elibrary(elibrary_article) {
        return new BibTexCollectionEntry(
            elibrary_article._authors,
            elibrary_article._title,
            elibrary_article._journal, // Используем journal как booktitle для конференций
            elibrary_article._year,
            elibrary_article._pages,
            elibrary_article._url,
            elibrary_article._doi,
            elibrary_article._language,
            elibrary_article._publisher,
            STORE_ABSTRACT ? elibrary_article._abstract : '',
        );
    }

    get_entry_type() {
        return 'incollection';
    }
}

/**
 * Example (see: https://github.com/AndreyAkinshin/Russian-Phd-LaTeX-Dissertation-Template/blob/master/biblio/registered.bib):
 * @Patent{progbib1,
 *   heading =      {Свидетельство о гос. регистрации программы для {ЭВМ}},
 *   author =       {Петров, П. П.},
 *   title =        {foobar},
 *   media =        {text},  // ??
 *   holder =       {НИИ~ГДААДАВБА},
 *   reqnumber =    1234567890,  // {req}uest, Номер заявки
 *   publdate =     {2020-01-02},  // Дата публикации
 *   date =         {2020-01-01},  // Дата регистрации
 *   prnumber =     1234567890,  // Номер свидетельства
 *   prcountry =    {countryru},
 *   language =     {russian},
 *   authorprogram ={yes},
 * }
 * */
class BibTexPatentProgramEntry extends BibTexEntry {
    constructor(author, title, year, url, /*doi, language, publisher,*/
        holder, reqnumber, publdate, regdate, prnumber) {
        super(author, title, year, url, /*doi, language, publisher*/);
        this._holder = holder || '';
        this._reqnumber = reqnumber || '';
        this._publdate = publdate || '';
        this._date = regdate || '';
        this._prnumber = prnumber || '';
    }

    static from_elibrary(elibrary_article) {
        return new BibTexPatentProgramEntry(
            elibrary_article._authors,
            elibrary_article._title,
            elibrary_article._year,
            elibrary_article._url,
            // Specific ↓
            elibrary_article._holder,
            elibrary_article._reqnumber,
            elibrary_article._publdate,
            elibrary_article._regdate,
            elibrary_article._prnumber,
        );
    }

    get_entry_type() {
        return 'Patent';
    }

    get_fields() {
        return [
                this.get_field('heading', 'Свидетельство о гос. регистрации программы для {ЭВМ}'),
                // ...super.get_fields(),
                this.get_field('author', this.get_authors_formatted()),
                this.get_field('title'),

                this.get_field('holder'),
                this.get_field('reqnumber'),
                this.get_field('publdate'),
                this.get_field('date'),
                this.get_field('prnumber'),

                this.get_field('url'),
                this.get_field('language'),
                this.get_field('authorprogram', 'yes'),
        ];
    }
}

function insert_to_page(bibtex_str, many=false) {
    // Создаём контейнер для BibTeX и кнопки
    const container = document.createElement('div');
    container.style.margin = '20px 0';
    container.style.padding = '10px';
    container.style.border = '1px solid #ccc';
    container.style.backgroundColor = '#f9f9f9';

    // Добавляем заголовок
    const header = document.createElement('h4');
    header.innerText = many ? 'Bibtex для этих публикаций:' : 'Bibtex для этой публикации:';
    header.style.marginTop = '0px';
    container.appendChild(header);

    // Добавляем текст BibTeX
    const bibtexPre = document.createElement('pre');
    bibtexPre.style.whiteSpace = 'pre-wrap';
    bibtexPre.style.fontSize = '11px';
    // bibtexPre.style.textIndent = '50px';
    bibtexPre.innerText = bibtex_str || 'Не удалось получить.';
    if (!many) {
        // Добавить без сворачивания.
        container.appendChild(bibtexPre);
    } else {
        // Обернуть в спойлер.
        const details = document.createElement('details');
        const summary = document.createElement('summary')
        summary.innerText = '[Спойлер]';
        details.appendChild(summary);
        details.appendChild(bibtexPre);
        container.appendChild(details);
    }

    if (bibtex_str)
    {
        // Текст не пустой.
        // Добавляем кнопку "Скопировать"
        const copyButton = document.createElement('button');
        copyButton.innerText = 'Скопировать (Ctrl+B)';
        copyButton.style.marginTop = '10px';
        copyButton.style.padding = '5px 10px';
        copyButton.style.backgroundColor = '#007bff';
        copyButton.style.color = '#fff';
        copyButton.style.border = 'none';
        copyButton.style.borderRadius = '5px';
        copyButton.style.cursor = 'pointer';

        copyButton.addEventListener('click', () => {
            navigator.clipboard.writeText(bibtex_str).then(() => {
                copyButton.innerText = 'Скопировано!';
                setTimeout(() => {
                    copyButton.innerText = 'Скопировать';
                }, 2000);
            }).catch(err => {
                console.error('Ошибка при копировании: ', err);
                copyButton.innerText = 'Ошибка!';
            });
        });

        container.appendChild(copyButton);

        // Добавляем обработчик горячей клавиши Ctrl + B
        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.code === 'KeyB') {
                navigator.clipboard.writeText(bibtex_str).then(() => {
                    copyButton.innerText = 'Скопировано (Ctrl+B)!';
                    setTimeout(() => {
                        copyButton.innerText = 'Скопировать';
                    }, 2000);
                }).catch(err => {
                    console.error('Ошибка при копировании: ', err);
                    copyButton.innerText = 'Ошибка!';
                });
            }
        });
    }

    // Вставляем контейнер на страницу
    if (!many) {
        // В конец страницы о публикации.
        const tables = document.querySelectorAll('table');
        tables[tables.length - 3/*3*/].insertAdjacentElement('afterend', container);
    } else {
        // В начало документа со списком публикаций.
        document.body.insertAdjacentElement('afterbegin', container);
    }
}


function handlePublicationPage() {
    'use strict';
    try {
        const metadata = ElibraryPublicationMetadata.parse(document);
        if (!metadata) {
            return false;
        }
        let bibtexEntry = metadata.get_bibtex_entry();

        // Вставляем BibTeX на страницу с интерактивными элементами
        insert_to_page(bibtexEntry);
        if (bibtexEntry) {
            const fromLocation = parseArticleLinkTarget(window.location.href) || {};
            const fromMetadataUrl = parseArticleLinkTarget(metadata._url || '') || {};
            const publicationId = fromLocation.publicationId || fromMetadataUrl.publicationId || '';
            const edn = fromLocation.edn || fromMetadataUrl.edn || '';
            CollectedBibtexStore.upsert({
                publicationId,
                edn,
                sourceUrl: metadata._url || window.location.href,
                bibtex: bibtexEntry,
                title: metadata._title || '',
                year: metadata._year || '',
                abstract: STORE_ABSTRACT ? (metadata._abstract || '') : '',
            });
        }
        return true;
    } catch (e) {
        // alert("Скрипт [elibrary-RSCI-to-BibTex] из расширения Tampermonkey.\nВозникла ошибка при извлечении библиографической информации! \nПодробности см. в консоли разработчика (F12) ↓");
        console.log('handlePublicationPage run into errors...');
        console.error(e);
        return false;
    }
}

(async function() {
    'use strict';

    // Проверяем сайт
    const currentHost = window.location.host;
    if (!currentHost.includes('elibrary.ru')) {
        console.log('The website is not elibrary.ru, exiting.');
        return;
    }

    // Set website root (host, domain).
    // 'https://elibrary.ru' or 'https://www.elibrary.ru'
    ELIBRARY_DOMAIN = window.location.origin;

    const currentUrl = window.location.href;

    try {
        const isPublicationPage = !!parseArticleLinkTarget(currentUrl);
        if (isPublicationPage) {
            handlePublicationPage();
        }

        ensureToolbar();
        markKnownArticleLinks();
    } catch (e) {
        alert("Скрипт [elibrary-RSCI-to-BibTex] из расширения Tampermonkey.\nВозникла ошибка при извлечении библиографической информации! \nПодробности см. в консоли разработчика (F12) ↓");
        console.error(e);
    }
})();
