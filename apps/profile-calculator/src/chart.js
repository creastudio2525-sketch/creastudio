'use strict';

function createProfileChart(canvas, empty, tooltip) {
  const ctx = canvas.getContext('2d');
  const font = 'Meiryo, "Hiragino Sans", sans-serif';
  const navy = '#2d3082';
  const blue = '#269dd8';
  const axis = '#536483';
  let alignment = null;
  let rows = [];
  let markers = [];

  function axisRange(minimum, maximum, count, minimumStep) {
    const raw = Math.max((maximum - minimum) / count, minimumStep);
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const units = [1, 2, 2.5, 5, 10].find((step) => step >= raw / magnitude) ?? 10;
    const step = units * magnitude;
    const low = Math.floor(minimum / step) * step;
    const high = Math.max(low + step, Math.ceil(maximum / step) * step);
    const ticks = [];
    for (let tick = low; tick <= high + step / 1000 && ticks.length < 15; tick += step) ticks.push(tick);
    return { low, high, ticks, step };
  }

  function label(value, step) {
    const precision = Math.min(4, Math.max(0, Math.ceil(-Math.log10(step / 2))));
    return Number(value.toFixed(precision)).toLocaleString('ja-JP', { maximumFractionDigits: precision });
  }

  function path(samples, x, y) {
    for (const [index, sample] of samples.entries()) {
      ctx[index ? 'lineTo' : 'moveTo'](x(sample.distance), y(sample.height));
    }
  }

  function stroke(samples, x, y, color, width, dash = []) {
    if (samples.length < 2) return;
    ctx.beginPath();
    path(samples, x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    markers = [];
    tooltip.hidden = true;
    if (!alignment || width < 100 || height < 100) return;

    const first = alignment.first.distance;
    const last = alignment.last.distance;
    const minimum = Math.min(first, rows[0]?.distance ?? first);
    const maximum = Math.max(last, rows.at(-1)?.distance ?? last);
    const intervals = [
      { from: minimum, to: first, type: 'extension' },
      ...alignment.tangents.map((tangent) => ({ from: tangent.start.distance, to: tangent.end.distance, type: 'route' })),
      { from: last, to: maximum, type: 'extension' },
    ].filter((segment) => segment.to > segment.from);
    const profile = intervals.map((segment) => {
      const stations = [];
      const subdivisions = Math.max(1, Math.ceil((segment.to - segment.from) / (maximum - minimum) * 160));
      for (let index = 0; index <= subdivisions; index++) {
        stations.push(segment.from + (segment.to - segment.from) * (index / subdivisions));
      }
      for (const curve of alignment.curves) {
        const extremum = curve.begin - curve.incoming / (curve.outgoing - curve.incoming) * curve.length;
        const important = [curve.begin, curve.end];
        if (extremum > curve.begin && extremum < curve.end) important.push(extremum);
        stations.push(...important.filter((station) => station > segment.from && station < segment.to));
      }
      return {
        type: segment.type,
        samples: stations.sort((a, b) => a - b).map((distance) => ({ distance, height: alignment.at(distance).height })),
      };
    });
    const samples = profile.flatMap((segment) => segment.samples);
    let low = Infinity;
    let high = -Infinity;
    for (const { height: elevation } of [...rows, ...samples]) {
      low = Math.min(low, elevation);
      high = Math.max(high, elevation);
    }

    const compact = width < 510;
    const horizontal = axisRange(minimum - (maximum - minimum) * 0.03, maximum + (maximum - minimum) * 0.03, compact ? 4 : 8, 0.001);
    const verticalPadding = Math.max((high - low) * 0.12, 0.025);
    const vertical = axisRange(low - verticalPadding, high + verticalPadding, compact ? 4 : 5, 0.001);
    const left = compact ? 53 : 69;
    const right = width - (compact ? 13 : 22);
    const top = 32;
    const bottom = height - 45;
    const x = (distance) => left + (distance - horizontal.low) / (horizontal.high - horizontal.low) * (right - left);
    const y = (elevation) => bottom - (elevation - vertical.low) / (vertical.high - vertical.low) * (bottom - top);

    ctx.font = '11px ' + font;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = axis;
    ctx.textAlign = 'left';
    ctx.fillText('高さ (m)', left - (compact ? 41 : 49), 16);
    ctx.textAlign = 'center';
    ctx.fillText('累加距離 (m)', (left + right) / 2, height - 10);
    ctx.strokeStyle = '#e4ebf5';
    ctx.lineWidth = 1;
    for (const elevation of vertical.ticks) {
      const ordinate = Math.round(y(elevation)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, ordinate);
      ctx.lineTo(right, ordinate);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(label(elevation, vertical.step), left - 7, ordinate, left - 9);
    }
    for (const distance of horizontal.ticks) {
      const abscissa = Math.round(x(distance)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(abscissa, top);
      ctx.lineTo(abscissa, bottom);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(label(distance, horizontal.step), abscissa, bottom + 15, compact ? 55 : 75);
    }
    ctx.strokeStyle = '#c8d4e8';
    ctx.beginPath();
    ctx.moveTo(left + 0.5, top);
    ctx.lineTo(left + 0.5, bottom + 0.5);
    ctx.lineTo(right, bottom + 0.5);
    ctx.stroke();

    const fill = ctx.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, '#d9effd');
    fill.addColorStop(1, '#f2f8ff');
    const inside = profile.filter((segment) => segment.type === 'route').flatMap((segment) => segment.samples);
    ctx.beginPath();
    path(inside, x, y);
    ctx.lineTo(x(last), bottom);
    ctx.lineTo(x(first), bottom);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const segment of profile) {
      if (segment.type === 'route') stroke(segment.samples, x, y, navy, 2.5);
      else stroke(segment.samples, x, y, '#536bb0', 2.2, [5, 5]);
    }

    for (const curve of alignment.curves) {
      const begin = alignment.at(curve.begin);
      const end = alignment.at(curve.end);
      stroke([{ distance: curve.begin, height: begin.height }, curve, { distance: curve.end, height: end.height }], x, y, '#919bc8', 1.15, [3, 4]);
      const curveSamples = samples.filter((point) => point.distance > curve.begin && point.distance < curve.end);
      stroke([{ distance: curve.begin, height: begin.height }, ...curveSamples, { distance: curve.end, height: end.height }], x, y, blue, 3.1);
    }

    const ordered = [...rows.filter((row) => row.source === 'calculated'), ...rows.filter((row) => row.source === 'input')];
    for (const row of ordered) {
      const marker = { x: x(row.distance), y: y(row.height), row };
      const input = row.source === 'input';
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, input ? 5.4 : 4.8, 0, 2 * Math.PI);
      ctx.fillStyle = input ? navy : '#fff';
      ctx.strokeStyle = input ? '#fff' : blue;
      ctx.lineWidth = input ? 1.5 : 2;
      ctx.fill();
      ctx.stroke();
      markers.push(marker);
    }
  }

  function update(newAlignment, newRows) {
    alignment = newAlignment;
    rows = newRows;
    empty.hidden = Boolean(alignment);
    draw();
  }

  canvas.addEventListener('pointermove', (event) => {
    const bounds = canvas.getBoundingClientRect();
    const horizontal = event.clientX - bounds.left;
    const vertical = event.clientY - bounds.top;
    let nearest;
    let nearestDistance = 20;
    for (const marker of markers) {
      const distance = Math.hypot(horizontal - marker.x, vertical - marker.y);
      if (distance <= nearestDistance) {
        nearest = marker;
        nearestDistance = distance;
      }
    }
    tooltip.hidden = !nearest;
    if (!nearest) return;
    const { row } = nearest;
    const source = row.type === 'intersection' ? '入力点（PVI）' : row.source === 'input' ? '入力点' : '計算点';
    tooltip.textContent = source + ' · ' + row.station + ' · ' + row.height.toFixed(3) + ' m';
    tooltip.style.left = Math.max(4, Math.min(canvas.clientWidth - tooltip.offsetWidth - 4, nearest.x + 9)) + 'px';
    tooltip.style.top = Math.max(4, nearest.y - tooltip.offsetHeight - 9) + 'px';
  });
  canvas.addEventListener('pointerleave', () => { tooltip.hidden = true; });
  new ResizeObserver(draw).observe(canvas);
  return { update };
}

