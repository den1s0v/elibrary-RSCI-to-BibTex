// ==UserScript==
// @name         elibrary-RSCI-to-BibTex
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Elibrary (Russian Science Citation Index) to BibTex article citation
// @author       You
// @match        https://elibrary.ru/item.asp?id=*
// @match        https://www.elibrary.ru/item.asp?id=*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tampermonkey.net
// @grant        none
// ==/UserScript==

const translit_data = {
    "А":"A", "а":"a", "Б":"B", "б":"b", "В":"V", "в":"v", "Г":"G", "г":"g", "Д":"D", "д":"d",
    "Е":"E", "е":"e", "Ж":"ZH", "ж":"zh", "З":"Z", "з":"z", "И":"I", "и":"i", "Й":"I", "й":"i",
    "К":"K", "к":"k", "Л":"L", "л":"l", "М":"M", "м":"m", "Н":"N", "н":"n", "О":"O", "о":"o",
    "П":"P", "п":"p", "Р":"R", "р":"r", "С":"S", "с":"s", "Т":"T", "т":"t", "У":"U", "у":"u",
    "Ф":"F", "ф":"f", "Х":"H", "х":"h", "Ц":"TS", "ц":"ts", "Ч":"CH", "ч":"ch", "Ш":"SH", "ш":"sh",
    "Щ":"SCH", "щ":"sch", "Ъ":"'", "ъ":"'", "Ы":"Y", "ы":"y", "Ь":"'", "ь":"'", "Э":"E", "э":"e",
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
    constructor(url, title, authors, affiliations, type, language, volume, number, year, pages, journal, abstract) {
        this._url = url || '';
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
                metadata._language = value;
            } else if (kind.includes('Том')) {
                metadata._volume = value;
            } else if (kind.includes('Номер')) {
                metadata._number = value;
            } else if (kind.includes('Год')) {
                metadata._year = value;
            } else if (kind.includes('Страницы')) {
                metadata._pages = value;
            } else {
                console.log('Not recognized: ', kind, value);
            }
        });
    }

    static parse(document) {
        let metadata = new ElibraryArticleMetadata();

        let tables = document.querySelectorAll('table');
        let di = -2;

        metadata._url = tables[di + 24].querySelectorAll('td')[1].baseURI;
        metadata._title = tables[di + 25].querySelector('.bigtext').innerText;

        let authors_raw_list = [];
        for (let author of tables[di + 26].querySelectorAll('font')) {
            authors_raw_list.push(author.innerText);
        }
        [metadata._authors, metadata._affiliations] = divide_authors_info(authors_raw_list);

        const bibl_meta_table = tables[di + 27];
        ElibraryArticleMetadata.recognize_biblio_metadata_table(bibl_meta_table, metadata);

        metadata._journal = tables[di + 28].querySelector('a').innerText;

        let tbl = tables[di + 29];
        if (tbl.querySelectorAll('td')[0].innerText === 'АННОТАЦИЯ:') {
            metadata._abstract = tbl.querySelectorAll('td')[2].innerText;
        }

        // try next one
        tbl = tables[di + 30];
        if (tbl.querySelectorAll('td')[0].innerText === 'АННОТАЦИЯ:') {
            metadata._abstract = tbl.querySelectorAll('td')[2].innerText;
        }

        return metadata;
    }
}

// ElibraryArticleMetadata.parse(document)

class BibTexArticleEntry {
    constructor(author, title, journal, year, volume, number, pages, url) {
        this._author = author || '';
        this._title = title || '';
        this._journal = journal || '';
        this._year = year || '';
        this._volume = volume || '';
        this._number = number || '';
        this._pages = pages || '';
        this._url = url || '';
    }

    static from_elibrary(elibrary_article) {
        let entry = new BibTexArticleEntry()
        entry._author = elibrary_article._authors //elibrary_article._authors.forEach(author => '{' + author + '}').join(' and ')
        entry._title = elibrary_article._title
        entry._journal = elibrary_article._journal
        entry._year = elibrary_article._year
        entry._volume = elibrary_article._volume
        entry._number = elibrary_article._number
        entry._pages = elibrary_article._pages
        entry._url = elibrary_article._url
        return entry
    }

    get_id() {
        const author = this._author[0]
        const author_surname = min_string(author.split(' ')[0], author.split(' ')[0]) // Ordinary space (32) or &nbsp; (160)
        return transliterate(author_surname) + '_' + this._year
    }

    get() {
        let formatted_authors = [...this._author]
        formatted_authors.forEach(function(part, index){ formatted_authors[index] = '{' + part + '}'})
        let answer =["@article{" + this.get_id() + ',',
            '    ' + "author = " + '{' + formatted_authors.join(' and ') + '},',
            '    ' + "title = " + '\"{' + this._title + '}\",',
            '    ' + "journal = " + '\"{' + this._journal + '}\",',
            '    ' + "year = " + this._year  + ',',
            '    ' + "volume = " + '\"' + this._volume + '\",',
            '    ' + "number = " + '\"' + this._number + '\",',
            '    ' + "pages = " + '\"' + this._pages + '\",',
            '    ' + "url = " + '{' + this._url + '}',
            '}']
        return answer.join(' \n')
    }
}

(function() {
    'use strict';
    try {
        let BibTexEntry = BibTexArticleEntry.from_elibrary(ElibraryArticleMetadata.parse(document)).get();
        let tables = document.querySelectorAll('table');
        let p_open = '<p style="font-size: 11px; text-indent: 50px;">';
        tables[tables.length - 3].insertAdjacentHTML("afterend", p_open + BibTexEntry.replaceAll('\n', '<\p>' + p_open).
            replaceAll('   ', "&nbsp;&nbsp;&nbsp;&nbsp;") + '<\p>');
        tables[tables.length - 3].insertAdjacentHTML("afterend", '<h4>elibrary-RSCI-to-BibTex:</h4>');
    } catch (e) {
        alert("Скрипт [elibrary-RSCI-to-BibTex] из расширения Tampermonkey.\nВозникла ошибка при извлечении библиографической информации! \nПодробности см. в консоли разработчика (F12) ↓");
        console.error(e);
    }
})();
