import { test } from 'node:test';
import assert from 'node:assert/strict';
import { towns } from '../src/config.js';
import { matchTowns, scanTowns } from '../src/matcher.js';

const ids = (s: string) => matchTowns(s).map((m) => m.townId);

test('catalogue: Вінниця, Ладижин, Козятин in order', () => {
    assert.deepEqual(towns.map((t) => t.id), ['vinnytsia', 'ladyzhyn', 'koziatyn']);
});

for (const t of towns) {
    test(`${t.id}: every shouldMatch hits this town and only this town`, () => {
        for (const s of t.fixtures.shouldMatch) assert.deepEqual(ids(s), [t.id], `should match only ${t.id}: ${s}`);
    });

    test(`${t.id}: every shouldNotMatch hits no town`, () => {
        for (const s of t.fixtures.shouldNotMatch) assert.deepEqual(ids(s), [], `should NOT match: ${s}`);
    });
}

test('one post can name several towns', () => {
    assert.deepEqual(ids('БпЛА з Вінниці на Козятин, далі Ладижин'), ['vinnytsia', 'ladyzhyn', 'koziatyn']);
});

test('the matched form is reported verbatim', () => {
    assert.equal(matchTowns('над Козятином')[0].form.toLowerCase(), 'козятином');
});

test('a town named only as a landmark is reported, not matched', () => {
    const r = scanTowns('1х реактивний східніше Вінниці на Погребище, далі Козятин');
    assert.deepEqual(r.matches.map((m) => m.townId), ['koziatyn']);
    assert.deepEqual(r.landmarkOnly, ['vinnytsia']);
});

test('landmark phrases work for every town', () => {
    assert.deepEqual(ids('БпЛА західніше Козятина'), []);
    assert.deepEqual(ids('БпЛА південніше Ладижина'), []);
});
