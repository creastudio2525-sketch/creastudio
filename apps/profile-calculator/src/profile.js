'use strict';

const Profile = (() => {
  const numberPattern = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|\\.\\d+';
  const decimal = new RegExp('^[+-]?(?:' + numberPattern + ')$');
  const numberedStation = new RegExp('^(?:NO\\.?\\s*)?([+-]?\\d+)\\s*([+-])\\s*(' + numberPattern + ')$');
  const plainNumberedStation = /^NO\.?\s*([+-]?\d+)$/;

  function normalized(value) {
    return String(value ?? '').normalize('NFKC').replace(/[−‐－]/g, '-').trim();
  }

  function parseNumber(raw, message) {
    const value = normalized(raw);
    const number = Number(value.replaceAll(',', ''));
    if (!decimal.test(value) || !Number.isFinite(number)) throw new Error(message);
    return number;
  }

  function parseStation(raw, spacing = 20) {
    const value = normalized(raw).toUpperCase().replace(/\s*M$/, '');
    const numbered = value.match(numberedStation);
    const plain = value.match(plainNumberedStation);
    if (numbered || plain) {
      const interval = parseNumber(spacing, '測点間隔を数値で入力してください。');
      if (interval <= 0) throw new Error('測点間隔は 0 m より大きくしてください。');
      const offset = numbered ? Number(numbered[3].replaceAll(',', '')) * (numbered[2] === '-' ? -1 : 1) : 0;
      const distance = Number((numbered || plain)[1]) * interval + offset;
      if (Number.isFinite(distance)) return distance;
      throw new Error('測点の距離が大きすぎます。');
    }
    return parseNumber(value.replace(/^SP\.?\s*/, ''), '測点を SP160、No.8+5.5、または 160.5 の形式で入力してください。');
  }

  function buildAlignment(rows, rawSpacing = 20) {
    const spacing = parseNumber(rawSpacing, '測点間隔を数値で入力してください。');
    if (spacing <= 0) throw new Error('測点間隔は 0 m より大きくしてください。');

    const points = [];
    for (const [index, row] of rows.entries()) {
      if (![row.station, row.elevation, row.curveLength].some((value) => normalized(value))) continue;
      const label = '入力点 ' + (index + 1) + '：';
      try {
        const distance = parseStation(row.station, spacing);
        const height = parseNumber(row.elevation, '高さを数値で入力してください。');
        const length = normalized(row.curveLength) ? parseNumber(row.curveLength, '曲線長を数値で入力してください。') : 0;
        if (length < 0) throw new Error('曲線長は 0 m 以上にしてください。');
        points.push({ station: row.station.trim(), distance, height, length });
      } catch (error) {
        throw new Error(label + error.message);
      }
    }

    if (points.length < 2) throw new Error('測点と高さを持つ入力点が 2 点以上必要です。');
    points.sort((a, b) => a.distance - b.distance);
    const first = points[0];
    const last = points.at(-1);
    if (first.length || last.length) throw new Error('起点・終点の曲線長は空欄または 0 m にしてください。');

    const tangents = points.slice(1).map((end, index) => {
      const start = points[index];
      const length = end.distance - start.distance;
      if (length <= 1e-9) throw new Error(start.station + ' と ' + end.station + ' の累加距離が重複しています。');
      const slope = (end.height - start.height) / length;
      if (!Number.isFinite(length) || !Number.isFinite(slope * 100)) throw new Error('距離または勾配が大きすぎます。');
      return { start, end, slope };
    });

    const curves = [];
    for (let index = 1; index < points.length - 1; index++) {
      const point = points[index];
      if (!point.length) continue;
      const begin = point.distance - point.length / 2;
      const end = point.distance + point.length / 2;
      if (begin < points[index - 1].distance - 1e-9 || end > points[index + 1].distance + 1e-9) {
        throw new Error(point.station + ' の曲線長が隣の入力点を越えています。');
      }
      const previous = curves.at(-1);
      if (previous && begin < previous.end - 1e-9) {
        throw new Error(previous.station + ' と ' + point.station + ' の縦断曲線が重なっています。');
      }
      const incoming = tangents[index - 1].slope;
      const outgoing = tangents[index].slope;
      curves.push({ ...point, begin, end, incoming, outgoing, beginHeight: point.height - incoming * point.length / 2 });
    }

    function at(distance) {
      if (!Number.isFinite(distance)) throw new Error('測点の距離を数値で入力してください。');
      const curve = curves.find((item) => distance >= item.begin - 1e-9 && distance <= item.end + 1e-9);
      if (curve) {
        const offset = Math.max(0, Math.min(curve.length, distance - curve.begin));
        const gradeChange = (curve.outgoing - curve.incoming) * (offset / curve.length);
        const height = curve.beginHeight + offset * (curve.incoming + gradeChange / 2);
        return { height, grade: (curve.incoming + gradeChange) * 100, type: 'curve' };
      }

      let type = 'straight';
      let tangent = tangents.find((item) => distance < item.end.distance) ?? tangents.at(-1);
      if (distance < first.distance) {
        type = 'before';
        tangent = tangents[0];
      } else if (distance > last.distance) {
        type = 'after';
      }
      const height = tangent.start.height + (distance - tangent.start.distance) * tangent.slope;
      if (!Number.isFinite(height)) throw new Error('計算した高さが表示範囲を超えています。');
      return { height, grade: tangent.slope * 100, type };
    }

    return { points, tangents, curves, first, last, spacing, at };
  }

  function calculateResults(alignment, targets) {
    const rows = alignment.points.map((point) => ({
      ...point, source: 'input', type: point.length ? 'intersection' : 'control', grade: null,
    }));
    const errors = [];
    for (const [index, raw] of targets.entries()) {
      if (!normalized(raw)) continue;
      try {
        const distance = parseStation(raw, alignment.spacing);
        rows.push({ station: raw.trim(), distance, ...alignment.at(distance), source: 'calculated', targetIndex: index });
      } catch (error) {
        errors.push({ index, message: error.message });
      }
    }
    rows.sort((a, b) => a.distance - b.distance || Number(a.source === 'calculated') - Number(b.source === 'calculated'));
    return { rows, errors };
  }

  return { parseStation, buildAlignment, calculateResults };
})();

if (typeof module !== 'undefined') module.exports = Profile;

