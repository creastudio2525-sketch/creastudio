const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStation, buildAlignment, calculateResults } = require('../src/profile.js');

const point = (station, elevation, curveLength = '') => ({ station, elevation, curveLength });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('recognizes SP, No. with offsets, full-width input, and cumulative meters', () => {
  assert.equal(parseStation('ＳＰ１６０．５'), 160.5);
  assert.equal(parseStation('No.8+5.5', 20), 165.5);
  assert.equal(parseStation('NO.2-2.5', 50), 97.5);
  assert.equal(parseStation('-2.5 m'), -2.5);
  assert.equal(parseStation('1,200.25'), 1200.25);
  assert.equal(parseStation('12+34.56', 100), 1234.56);
  assert.throws(() => parseStation('A-1'), /測点/);
});

test('interpolates sorted grades and extends the first and last grades', () => {
  const alignment = buildAlignment([point('SP200', '102'), point('SP0', '100'), point('SP100', '104')]);
  for (const [distance, height, grade, type] of [
    [-25, 99, 4, 'before'], [50, 102, 4, 'straight'],
    [150, 103, -2, 'straight'], [225, 101.5, -2, 'after'],
  ]) {
    const value = alignment.at(distance);
    near(value.height, height);
    near(value.grade, grade);
    assert.equal(value.type, type);
  }
});

test('evaluates a symmetrical crest curve and its tangent boundaries', () => {
  const alignment = buildAlignment([point('0', '100'), point('100', '104', '80'), point('200', '102')]);
  for (const [distance, height, grade] of [[60, 102.4, 4], [100, 103.4, 1], [140, 103.2, -2]]) {
    const value = alignment.at(distance);
    near(value.height, height);
    near(value.grade, grade);
    assert.equal(value.type, 'curve');
  }
  near(alignment.at(59.9999).height, 102.399996);
  near(alignment.at(140.0001).height, 103.199998);
});

test('calculates a sag curve and allows two curves to meet at their endpoints', () => {
  const alignment = buildAlignment([point('0', '100'), point('100', '98', '100'), point('200', '102', '100'), point('300', '101')]);
  near(alignment.at(100).height, 98.75);
  near(alignment.at(150).height, 100);
  near(alignment.at(150).grade, 4);
});

test('rejects duplicate chainages, overlaps, out-of-bounds curves and invalid heights', () => {
  assert.throws(() => buildAlignment([point('0', '100'), point('SP0', '101')]), /重複/);
  assert.throws(() => buildAlignment([point('0', '100'), point('100', '104', '120'), point('200', '101', '120'), point('300', '102')]), /重な/);
  assert.throws(() => buildAlignment([point('0', '100'), point('100', '104', '250'), point('200', '101')]), /曲線長/);
  assert.throws(() => buildAlignment([point('0', '100', '10'), point('100', '101')]), /曲線長/);
  assert.throws(() => buildAlignment([point('0', ' '), point('100', '101')]), /高さ/);
  assert.throws(() => buildAlignment([point('0', '0x10'), point('100', '101')]), /高さ/);
});

test('keeps entered PVI height distinct from the curve height at the same station', () => {
  const alignment = buildAlignment([point('0', '100'), point('100', '104', '80'), point('200', '102')]);
  const result = calculateResults(alignment, ['bad', 'SP100', 'SP220', '']);
  const matching = result.rows.filter((row) => row.distance === 100);
  assert.deepEqual(matching.map((row) => row.source), ['input', 'calculated']);
  near(matching[0].height, 104);
  near(matching[1].height, 103.4);
  assert.equal(result.rows.at(-1).type, 'after');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 0);
});

