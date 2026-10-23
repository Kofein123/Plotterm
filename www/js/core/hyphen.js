// Простые правила переноса для русского и казахского (по мотивам алгоритма П. Христова).
const VOWELS = 'аеёиоуыэюяәөұүіaeiouy';
const SPECIAL = 'йьъ';
function kind(ch) {
    const c = ch.toLowerCase();
    if (VOWELS.includes(c))
        return 'g';
    if (SPECIAL.includes(c))
        return 'x';
    if (/\p{L}/u.test(c))
        return 's';
    return 'o';
}
/** Позиции, где слово можно разорвать (перенос ставится перед символом с этим индексом). */
export function hyphenPoints(word) {
    const chars = [...word];
    const n = chars.length;
    if (n < 4)
        return [];
    const k = chars.map(kind);
    if (k.some((x) => x === 'o')) {
        // слово с цифрами/знаками — переносим только по дефису
        const out = [];
        chars.forEach((c, i) => {
            if (c === '-' && i > 1 && i < n - 2)
                out.push(i + 1);
        });
        return out;
    }
    const hasVowel = (from, to) => k.slice(from, to).includes('g');
    const pts = new Set();
    for (let i = 2; i <= n - 2; i++) {
        // разрыв между i-1 и i
        if (!hasVowel(0, i) || !hasVowel(i, n))
            continue;
        const a = k[i - 1];
        const b = k[i];
        const c = k[i + 1];
        if (b === 'x')
            continue; // й ь ъ не отрываем от предыдущей
        if (a === 'x') {
            pts.add(i);
            continue;
        }
        if (a === 'g' && b === 's' && c === 'g') {
            pts.add(i);
            continue;
        } // во-да
        if (a === 'g' && b === 'g') {
            pts.add(i);
            continue;
        } // по-эт
        const ci = chars[i - 1].toLowerCase();
        const cj = chars[i].toLowerCase();
        const cn = (chars[i + 1] ?? '').toLowerCase();
        if (a === 'g' && b === 's' && c === 's') {
            // перед сочетанием, которым начинаются слоги: о-стро, до-бро, мно-го-стра-нич-ной
            if (('сз'.includes(cj) && 'бвгдкптмнлр'.includes(cn)) || ('бвгдкпт'.includes(cj) && 'рл'.includes(cn)))
                pts.add(i);
            continue;
        }
        if (a === 's' && b === 's' && k[i - 2] === 'g') {
            // после первой согласной группы: кон-спект, мас-са, пол-ка; но не «с|т», «з|д» (не «мно-гос-тра…»)
            const sStop = 'сз'.includes(ci) && 'бвгдкптж'.includes(cj) && ci !== cj;
            const onset = 'бвгдкпт'.includes(ci) && 'рл'.includes(cj); // «бр», «тр» уходят на новую строку целиком
            if (!sStop && !onset)
                pts.add(i);
        }
    }
    return [...pts].filter((p) => p >= 2 && p <= n - 2).sort((x, y) => x - y);
}
