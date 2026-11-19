import { test } from 'node:test';
import assert from 'node:assert/strict';
import { towns } from '../src/config.js';
import { matchTowns, scanTowns } from '../src/matcher.js';

const ids = (s: string) => matchTowns(s).map((m) => m.townId);

test('catalogue: Вінниця, Ладижин, Козятин, Вороновиця in order', () => {
    assert.deepEqual(towns.map((t) => t.id), ['vinnytsia', 'ladyzhyn', 'koziatyn', 'voronovytsia']);
});

for (const t of towns) {
    test(`${t.id}: every shouldMatch hits this town and only this town`, () => {
        for (const s of t.fixtures.shouldMatch) assert.deepEqual(ids(s), [t.id], `should match only ${t.id}: ${s}`);
    });

    test(`${t.id}: every shouldNotMatch hits no town`, () => {
        for (const s of t.fixtures.shouldNotMatch) assert.deepEqual(ids(s), [], `should NOT match: ${s}`);
    });
}

for (const t of towns.filter((t) => t.districts)) {
    const local = (s: string) => matchTowns(s, { local: true }).map((m) => m.townId);

    test(`${t.id}: every district shouldMatch hits this town on a local channel only`, () => {
        for (const s of t.districts!.fixtures.shouldMatch) {
            assert.deepEqual(local(s), [t.id], `local should match ${t.id}: ${s}`);
            assert.deepEqual(ids(s), [], `national channel should NOT match: ${s}`);
        }
    });

    test(`${t.id}: every district shouldNotMatch hits no town, even on a local channel`, () => {
        for (const s of t.districts!.fixtures.shouldNotMatch) assert.deepEqual(local(s), [], `should NOT match: ${s}`);
    });
}

test('a district needs a shelter word; the town name does not', () => {
    const local = (s: string) => matchTowns(s, { local: true });
    assert.deepEqual(local('Шахед на Тяжилів'), []);
    assert.deepEqual(local('Тяжилів, в укриття').map((m) => [m.townId, m.district]), [['vinnytsia', true]]);
    assert.deepEqual(local('Шахед на Вінницю').map((m) => [m.townId, m.district]), [['vinnytsia', undefined]]);
});

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

test('Вороновиця: the settlement fires, the adjective and a dual mention do not mix up', () => {
    assert.deepEqual(ids('Реактивний БпЛА на Вороновицю/Вінницю'), ['vinnytsia', 'voronovytsia']);
    assert.deepEqual(ids('Вороновицька громада'), []);
});
