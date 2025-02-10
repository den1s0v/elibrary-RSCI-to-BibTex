// ==UserScript==
// @name         elibrary-RSCI-to-BibTex
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Elibrary (Russian Science Citation Index) to BibTex article citation
// @author       You
// @match        https://elibrary.ru/item.asp?id=*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tampermonkey.net
// @grant        none
// ==/UserScript==

var translit_data = {"Ё":"YO","Й":"I","Ц":"TS","У":"U","К":"K","Е":"E","Н":"N","Г":"G","Ш":"SH","Щ":"SCH","З":"Z","Х":"H","Ъ":"'","ё":"yo","й":"i","ц":"ts","у":"u","к":"k","е":"e","н":"n","г":"g","ш":"sh","щ":"sch","з":"z","х":"h","ъ":"'","Ф":"F","Ы":"I","В":"V","А":"A","П":"P","Р":"R","О":"O","Л":"L","Д":"D","Ж":"ZH","Э":"E","ф":"f","ы":"i","в":"v","а":"a","п":"p","р":"r","о":"o","л":"l","д":"d","ж":"zh","э":"e","Я":"Ya","Ч":"CH","С":"S","М":"M","И":"I","Т":"T","Ь":"'","Б":"B","Ю":"YU","я":"ya","ч":"ch","с":"s","м":"m","и":"i","т":"t","ь":"'","б":"b","ю":"yu"};
// https://stackoverflow.com/questions/11404047/transliterating-cyrillic-to-latin-with-javascript-function
function transliterate(word){
  return word.split('').map(function (char) {
    return translit_data[char] || char;
  }).join("");
}

function divide_authors_info(authors_raw_list) {
    function isNumeric(num){
        return !isNaN(num)
    }

    let authors = []
    let affiliations = []

    if (!authors_raw_list.some(author_value => isNumeric(author_value))) {
        // Cannot recognize
        return [authors_raw_list, affiliations];
    }

    const max_index = authors_raw_list.length - 1;
    let affiliations_start = max_index;
    let last_author;

    for (let i = 0; i <= max_index; i++) {
        const s = authors_raw_list[i]

        if (i === 0) {
            last_author = s
            authors.push(s)
            continue
        }
        if (isNumeric(s)) {
            for (let j = max_index-1; j > i; j--) {
                if (+s === +authors_raw_list[j]) {
                    affiliations.push([last_author, authors_raw_list[j+1]])
                    affiliations_start = Math.min(affiliations_start, j+1)
                    break
                }
            }
        }
        else if (i >= affiliations_start) {
            break
        }
        else {
            last_author = s
            authors.push(s)
        }
    }

    return [authors, affiliations]
}

// declaration
class ElibraryArticleMetadata {
    constructor(url, title, authors, affiliations, type, language,
                volume, number, year, pages, journal, abstract) {
        this._url = url;
        this._title = title;
        this._authors = authors;
        this._affiliations = affiliations;
        this._type = type;
        this._language = language;

        this._volume = volume;
        this._number = number;
        this._year = year;
        this._pages = pages;
        this._journal = journal;
        this._abstract = abstract;
    }

    static parse(document) {
        let metadata = new ElibraryArticleMetadata()

        let tables = document.querySelectorAll('table')
        let di = -2

        metadata._url = tables[di + 24].querySelectorAll('td')[1].baseURI
        metadata._title = tables[di + 25].querySelector('.bigtext').innerText

        let authors_raw_list = []
        for (let author of tables[di + 26].querySelectorAll('font')) {
            authors_raw_list.push(author.innerText)
        }
        [metadata._authors, metadata._affiliations] = divide_authors_info(authors_raw_list);

        const bibl_meta_table = tables[di + 27];

        let [type, language] = bibl_meta_table.querySelectorAll('td')[0].querySelectorAll('font')
        metadata._type = type.innerText
        metadata._language = language.innerText

        if (bibl_meta_table.querySelectorAll('td')[2].querySelectorAll('a, font').length == 3) {
            let [number, year, pages] = bibl_meta_table.querySelectorAll('td')[2].querySelectorAll('a, font')
            metadata._volume = ''
            metadata._number = number.innerText
            metadata._year = year.innerText
            metadata._pages = pages.innerText}
        else if (bibl_meta_table.querySelectorAll('td')[2].querySelectorAll('a, font').length >= 4) {
            let [tom, number, year, pages, ..._] = bibl_meta_table.querySelectorAll('td')[2].querySelectorAll('a, font')
            //alert(tom.innerText)
            metadata._volume = tom.innerText
            metadata._number = number.innerText
            metadata._year = year.innerText
            metadata._pages = pages.innerText
        }
////        else if (bibl_meta_table.querySelectorAll('td')[2].querySelectorAll('a, font').length == 5) {
////            let [tom, number, year, pages, _] = bibl_meta_table.querySelectorAll('td')[2].querySelectorAll('a, font')
////            metadata._volume = tom.innerText
////            metadata._number = number.innerText
////            metadata._year = year.innerText
////            metadata._pages = pages.innerText
////        }

        metadata._journal = tables[di + 28].querySelector('a').innerText

        let tbl = tables[di + 29]

        if (tbl.querySelectorAll('td')[0].innerText === 'АННОТАЦИЯ:') {
            metadata._abstract = tbl.querySelectorAll('td')[2].innerText
        }

        // try next one
        tbl = tables[di + 30]

        if (tbl.querySelectorAll('td')[0].innerText === 'АННОТАЦИЯ:') {
            metadata._abstract = tbl.querySelectorAll('td')[2].innerText
        }

        return metadata
    }
}

// ElibraryArticleMetadata.parse(document)

class BibTexArticleEntry {
    constructor(author, title, journal, year, volume, number, pages, url) {
        this._author = author;
        this._title = title;
        this._journal = journal;
        this._year = year;
        this._volume = volume;
        this._number = number;
        this._pages = pages;
        this._url = url;
    }

    static from_elibrary(elibrary_article) {
        let entry = new BibTexArticleEntry()
        entry._author = elibrary_article._authors
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
        return transliterate(this._author[0].split(' ')[0]) + '_' + this._year
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
        tables[tables.length-3].insertAdjacentHTML("afterend",p_open+BibTexEntry.replaceAll('\n', '<\p>'+p_open).
                                                   replaceAll('   ', "&nbsp;&nbsp;&nbsp;&nbsp;")+'<\p>');
        tables[tables.length-3].insertAdjacentHTML("afterend", '<h4>elibrary-RSCI-to-BibTex:</h4>');
    }
    catch (e) {
        alert("[elibrary-RSCI-to-BibTex] Возникла ошибка при переводе библиографической информации! Подробности см. в консоли разработчика ↓");
        console.error(e);
    }
})();
