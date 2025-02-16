// ==UserScript==
// @name         elibrary-RSCI-to-BibTex
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Elibrary (Russian Science Citation Index) to BibTex article citation
// @author       You
// @match        https://elibrary.ru/item.asp?id=*
// @match        https://www.elibrary.ru/item.asp?id=*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tampermonkey.net
// @grant        none
// ==/UserScript==

// const ENTRY_ID_PREFIX = '';
const ENTRY_ID_PREFIX = 'own_';

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

class ElibraryArticleMetadata {
    constructor(url, doi, title, authors, affiliations, type, language, volume, number, year, pages, journal, abstract, publisher) {
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
    }

    /**
    * @param[in|out] metadata object
    */
    static recognize_urls_table(table_element, metadata) {
        // eLIBRARY ID: … , EDN: … , (optional) DOI: …
        let value_tags = table_element.querySelectorAll('font');

        value_tags.forEach((tag) => {
            let kind = tag.previousSibling.data.trim();
            let href = tag.children[0].href;
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
    static recognize_biblio_metadata_table(table_element, metadata) {
        let value_tags = [
            ...table_element.querySelectorAll('td')[0].querySelectorAll('font'), // type, language
            ...table_element.querySelectorAll('td')[2].querySelectorAll('a, font'), // volume, number, year, pages, ...
        ];

        value_tags.map(n => [n.previousSibling.data.trim(), n.innerText]).forEach(([kind, value]) => {
            if (kind.includes('Тип')) {
                metadata._type = value;
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
            } else {
                console.log('Not recognized biblio: ', kind, value);
            }
        });
    }

    static parse(document) {
        let metadata = new ElibraryArticleMetadata();

        let tables = document.querySelectorAll('table');
        let di = -2;

        const urls_table = tables[di + 24];
        ElibraryArticleMetadata.recognize_urls_table(urls_table, metadata);

        metadata._title = tables[di + 25].querySelector('.bigtext').innerText;

        let authors_raw_list = [];
        for (let author of tables[di + 26].querySelectorAll('font')) {
            authors_raw_list.push(author.innerText);
        }
        [metadata._authors, metadata._affiliations] = divide_authors_info(authors_raw_list);

        const bibl_meta_table = tables[di + 27];
        ElibraryArticleMetadata.recognize_biblio_metadata_table(bibl_meta_table, metadata);

        const journal_table = tables[di + 28];
        const table_caption = journal_table.querySelector('td font').innerText;
        if (table_caption.includes('ЖУРНАЛ') || table_caption.includes('ИСТОЧНИК')) {

            metadata._journal = journal_table.querySelector('a').innerText;

            let publisher = journal_table.querySelectorAll('tr')[1].querySelector('td font');
            if (publisher && publisher.previousSibling.data.trim().includes('Издательство')) {
                metadata._publisher = publisher.innerText;
            }
        }

        // let tbl = tables[di + 29];
        // if (tbl.querySelectorAll('td')[0].innerText === 'АННОТАЦИЯ:') {
        //     metadata._abstract = tbl.querySelectorAll('td')[2].innerText;
        // }

        // // try next one
        // tbl = tables[di + 30];
        // if (tbl.querySelectorAll('td')[0].innerText === 'АННОТАЦИЯ:') {
        //     metadata._abstract = tbl.querySelectorAll('td')[2].innerText;
        // }

        return metadata;
    }
}

class BibTexEntry {
    constructor(author, title, year, url, doi, language, publisher) {
        this._author = author || '';
        this._title = title || '';
        this._year = year || '';
        this._url = url || '';
        this._doi = doi || '';
        this._language = language || '';
        this._publisher = publisher || '';
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

    get_fields() {
        let formatted_authors = this._author.map(author => author.replace(/*&nbsp;*/' ', ' ').replace(' ', ', ')).map(author => `{${author}}`).join(' and ');

        return [
            this.get_field('author', formatted_authors),
            this.get_field('title'),
            this.get_field('year'),
            this.get_field('doi'),
            this.get_field('url', null, !!this._doi),  // add URL explicitly only when DOI is absent.
            this.get_field('language'),
            this.get_field('publisher'),
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
    constructor(author, title, journal, year, volume, number, pages, url, doi, language, publisher) {
        super(author, title, year, url, doi, language, publisher);
        this._journal = journal || '';
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
    constructor(author, title, booktitle, year, pages, url, doi, language, publisher) {
        super(author, title, year, url, doi, language, publisher);
        this._booktitle = booktitle || '';
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

function insert_to_page(bibtex_str) {
    // Создаём контейнер для BibTeX и кнопки
    const container = document.createElement('div');
    container.style.margin = '20px 0';
    container.style.padding = '10px';
    container.style.border = '1px solid #ccc';
    container.style.backgroundColor = '#f9f9f9';

    // Добавляем заголовок
    const header = document.createElement('h4');
    header.innerText = 'Bibtex для этой публикации:';
    header.style.marginTop = '0px';
    container.appendChild(header);

    // Добавляем текст BibTeX
    const bibtexPre = document.createElement('pre');
    bibtexPre.style.whiteSpace = 'pre-wrap';
    bibtexPre.style.fontSize = '11px';
    // bibtexPre.style.textIndent = '50px';
    bibtexPre.innerText = bibtex_str;
    container.appendChild(bibtexPre);

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

    // Вставляем контейнер на страницу
    const tables = document.querySelectorAll('table');
    tables[tables.length - 3/*3*/].insertAdjacentElement('afterend', container);

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


(function() {
    'use strict';
    try {
        const metadata = ElibraryArticleMetadata.parse(document);
        let bibtexEntry;

        if (metadata._type.includes('конференци')) {
            bibtexEntry = BibTexConferenceEntry.from_elibrary(metadata).get();
        } else {
            bibtexEntry = BibTexArticleEntry.from_elibrary(metadata).get();
        }

        // Вставляем BibTeX на страницу с интерактивными элементами
        insert_to_page(bibtexEntry);
    } catch (e) {
        alert("Скрипт [elibrary-RSCI-to-BibTex] из расширения Tampermonkey.\nВозникла ошибка при извлечении библиографической информации! \nПодробности см. в консоли разработчика (F12) ↓");
        console.error(e);
    }
})();
