'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  const make = (tag, className, content) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  };
  const fixed = (value) => {
    const text = value.toFixed(3);
    return text === '-0.000' ? '0.000' : text;
  };
  const labels = {
    control: '基準点', intersection: '勾配変化点 (PVI)', straight: '直線区間',
    curve: '縦断曲線', before: '起点側の延長', after: '終点側の延長',
  };
  const chart = createProfileChart(byId('profile-chart'), byId('chart-empty'), byId('chart-tooltip'));
  const saveState = byId('save-state');
  const controlRows = byId('control-rows');
  const targetRows = byId('target-rows');
  const settingsDialog = byId('project-dialog');
  const calculatorDialog = byId('calculator-dialog');
  const calculatorExpression = byId('calculator-expression');
  const menuToggle = byId('menu-toggle');
  let workspace;
  let initialReadError = false;
  let newMode = false;
  let scheduled = false;
  let toastTimer;
  let calculatorTargetIndex = -1;
  let calculatorDemoExpression = '';
  let calculatorDemoActions = [];
  let calculatorDemoHistory = [];
  let calculatorDemoIndex = 0;
  let calculatorDemoTimer = null;
  let calculatorDemoActionRunning = false;
  const calculatorKeyButtons = new Map();

  function toast(message) {
    const element = byId('toast');
    clearTimeout(toastTimer);
    element.textContent = message;
    element.hidden = false;
    toastTimer = setTimeout(() => { element.hidden = true; }, 3800);
  }

  function saveStatus(status, message) {
    if (saveState.dataset.status === status && saveState.textContent === message) return;
    saveState.dataset.status = status;
    saveState.textContent = message;
  }

  function persist() {
    try {
      localStorage.setItem(Projects.storageKey, JSON.stringify(workspace));
      saveStatus('saved', '自動保存済み');
      return true;
    } catch {
      saveStatus('error', '保存できません。バックアップをご利用ください。');
      return false;
    }
  }

  try {
    workspace = Projects.readWorkspace(localStorage.getItem(Projects.storageKey));
  } catch {
    initialReadError = true;
    workspace = Projects.readWorkspace(null);
    saveStatus('error', '保存した路線を読み込めませんでした。');
  }

  const active = () => workspace.projects.find((project) => project.id === workspace.activeId);
  const closeDrawer = (restoreFocus = false) => {
    const wasOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    byId('sidebar').classList.remove('is-open');
    byId('drawer-backdrop').hidden = true;
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', '路線メニューを開く');
    if (wasOpen && restoreFocus) menuToggle.focus();
  };

  function drawProjects() {
    const buttons = workspace.projects.map((project) => {
      const button = make('button', 'project-link');
      button.type = 'button';
      const folder = make('span', 'icon i-folder');
      folder.setAttribute('aria-hidden', 'true');
      button.append(folder, make('span', 'project-link-text', project.name));
      button.title = project.name;
      if (project.id === workspace.activeId) {
        button.setAttribute('aria-current', 'true');
        const arrow = make('span', 'project-arrow', '›');
        arrow.setAttribute('aria-hidden', 'true');
        button.append(arrow);
      }
      button.addEventListener('click', () => {
        if (workspace.activeId !== project.id) {
          workspace.activeId = project.id;
          persist();
          drawProject();
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
        closeDrawer(true);
      });
      return button;
    });
    byId('project-list').replaceChildren(...buttons);
  }

  function field(value, placeholder, name, onInput, decimal = false) {
    const input = make('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (decimal) input.inputMode = 'decimal';
    input.setAttribute('aria-label', name);
    input.addEventListener('input', () => {
      onInput(input.value);
      persist();
      scheduleCalculation();
    });
    return input;
  }

  function removeButton(name, remove) {
    const button = make('button', 'icon-button delete-row');
    button.type = 'button';
    button.setAttribute('aria-label', name);
    button.title = name;
    const icon = make('span', 'icon i-close');
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);
    button.addEventListener('click', remove);
    return button;
  }

  function drawControls() {
    const project = active();
    const rows = project.points.map((point, index) => {
      const row = make('div', 'form-row control-layout');
      const label = '入力点 ' + (index + 1) + ' ';
      row.append(
        field(point.station, 'SP' + index * 20, label + '測点', (value) => { point.station = value; }),
        field(point.elevation, '100.000', label + '高さ (m)', (value) => { point.elevation = value; }, true),
        field(point.curveLength, '—', label + '曲線長 (m)', (value) => { point.curveLength = value; }, true),
        removeButton(label + 'を削除', () => {
          project.points.splice(index, 1);
          persist();
          drawControls();
          calculate();
          (controlRows.children[Math.min(index, project.points.length - 1)]?.querySelector('input') ?? byId('add-control')).focus();
        }),
      );
      return row;
    });
    controlRows.replaceChildren(...rows);
  }

  function drawTargets() {
    const project = active();
    const rows = project.targets.map((station, index) => {
      const row = make('div', 'form-row target-layout');
      const label = '計算点 ' + (index + 1) + ' ';
      const input = field(station, index === 0 ? 'SP10' : 'No.1+5.5', label + '測点', (value) => { project.targets[index] = value; });
      const height = make('output', 'target-height');
      height.setAttribute('aria-label', label + '計画高 (m)');
      const error = make('p', 'inline-error target-error');
      error.id = 'target-error-' + index;
      error.hidden = true;
      const calculator = make('button', 'icon-button calculator-row');
      calculator.type = 'button';
      calculator.setAttribute('aria-label', label + 'の計算式と関数電卓を表示');
      calculator.title = '計算式・関数電卓';
      const calculatorIcon = make('span', 'icon i-calculator');
      calculatorIcon.setAttribute('aria-hidden', 'true');
      calculator.append(calculatorIcon);
      calculator.addEventListener('click', () => openCalculator(index));
      row.append(
        input,
        height,
        removeButton(label + 'を削除', () => {
          project.targets.splice(index, 1);
          persist();
          drawTargets();
          calculate();
          (targetRows.children[Math.min(index, project.targets.length - 1)]?.querySelector('input') ?? byId('add-target')).focus();
        }),
        calculator,
        error,
      );
      return row;
    });
    targetRows.replaceChildren(...rows);
  }

  const formulaNumber = (value) => Number(value.toFixed(6)).toString();

  function targetFormula(index) {
    const project = active();
    const station = project.targets[index] ?? '';
    const normalizedStation = Profile.parseStation(station, project.spacing);
    const alignment = Profile.buildAlignment(project.points, project.spacing);
    const result = alignment.at(normalizedStation);
    const curve = alignment.curves.find((item) => normalizedStation >= item.begin - 1e-9 && normalizedStation <= item.end + 1e-9);
    const lines = ['測点: ' + (station || '（未入力）'), '累加距離 x = ' + formulaNumber(normalizedStation) + ' m', ''];
    if (curve) {
      const offset = Math.max(0, Math.min(curve.length, normalizedStation - curve.begin));
      const gradeChange = curve.outgoing - curve.incoming;
      const tangentRise = curve.incoming * offset;
      const curveCorrection = gradeChange * offset ** 2 / (2 * curve.length);
      lines.push('縦断曲線（放物線）');
      lines.push('この式の見方: 曲線始点の高さに、始点から進んだ距離分の高さの増分を加えます。曲線内では勾配が g1 から g2 へ少しずつ変わるため、その変化分も加味します。');
      lines.push('記号: H は計画高、Hs は曲線始点の高さ、d は曲線始点から計算点までの距離、g1 は曲線に入る勾配、g2 は曲線を出る勾配、L は曲線長です。勾配 g1・g2 は m/m で表します。');
      lines.push('H = Hs + g1 × d + (g2 − g1) × d² / (2 × L)');
      lines.push('Hs = ' + formulaNumber(curve.beginHeight) + ' m, g1 = ' + formulaNumber(curve.incoming) + ', g2 = ' + formulaNumber(curve.outgoing) + ', L = ' + formulaNumber(curve.length) + ' m');
      lines.push('d = x − 曲線始点 = ' + formulaNumber(normalizedStation) + ' − ' + formulaNumber(curve.begin) + ' = ' + formulaNumber(offset) + ' m');
      lines.push('H = ' + formulaNumber(curve.beginHeight) + ' + ' + formulaNumber(curve.incoming) + ' × ' + formulaNumber(offset) + ' + (' + formulaNumber(curve.outgoing) + ' − ' + formulaNumber(curve.incoming) + ') × ' + formulaNumber(offset) + '² / (2 × ' + formulaNumber(curve.length) + ')');
      lines.push('', '途中計算');
      lines.push('1) 曲線内の勾配変化 Δg = g2 − g1 = ' + formulaNumber(curve.outgoing) + ' − ' + formulaNumber(curve.incoming) + ' = ' + formulaNumber(gradeChange));
      lines.push('2) 始点勾配による高さ増分 = g1 × d = ' + formulaNumber(curve.incoming) + ' × ' + formulaNumber(offset) + ' = ' + formulaNumber(tangentRise) + ' m');
      lines.push('3) 曲線による補正量 = Δg × d² / (2 × L) = ' + formulaNumber(gradeChange) + ' × ' + formulaNumber(offset) + '² / (2 × ' + formulaNumber(curve.length) + ') = ' + formulaNumber(curveCorrection) + ' m');
      lines.push('4) 計画高 H = Hs + 高さ増分 + 補正量 = ' + formulaNumber(curve.beginHeight) + ' + (' + formulaNumber(tangentRise) + ') + (' + formulaNumber(curveCorrection) + ') = ' + formulaNumber(curve.beginHeight + tangentRise + curveCorrection) + ' m');
    } else {
      let tangent = alignment.tangents.find((item) => normalizedStation < item.end.distance) ?? alignment.tangents.at(-1);
      const start = tangent.start;
      const grade = tangent.slope;
      const distanceDifference = normalizedStation - start.distance;
      const heightDifference = distanceDifference * grade;
      lines.push(result.type === 'before' || result.type === 'after' ? '直線勾配の延長' : '直線区間');
      lines.push('この式の見方: 基準点の高さに、基準点から計算点までの距離差 × 勾配を加えます。起点前・終点後の場合も、端の勾配をそのまま延長して計算します。');
      lines.push('記号: H は計画高、H0 は基準点の高さ、x は計算点の累加距離、x0 は基準点の累加距離、g は区間の勾配 (m/m) です。');
      lines.push('H = H0 + (x − x0) × g');
      lines.push('H0 = ' + formulaNumber(start.height) + ' m, x0 = ' + formulaNumber(start.distance) + ' m, g = ' + formulaNumber(grade));
      lines.push('H = ' + formulaNumber(start.height) + ' + (' + formulaNumber(normalizedStation) + ' − ' + formulaNumber(start.distance) + ') × ' + formulaNumber(grade));
      lines.push('', '途中計算');
      lines.push('1) 距離差 Δx = x − x0 = ' + formulaNumber(normalizedStation) + ' − ' + formulaNumber(start.distance) + ' = ' + formulaNumber(distanceDifference) + ' m');
      lines.push('2) 勾配による高さ増分 ΔH = Δx × g = ' + formulaNumber(distanceDifference) + ' × ' + formulaNumber(grade) + ' = ' + formulaNumber(heightDifference) + ' m');
      lines.push('3) 計画高 H = H0 + ΔH = ' + formulaNumber(start.height) + ' + (' + formulaNumber(heightDifference) + ') = ' + formulaNumber(start.height + heightDifference) + ' m');
    }
    lines.push('', '計画高 H = ' + fixed(result.height) + ' m');
    return lines.join('\n');
  }

  function renderFormula(text) {
    const element = byId('formula-text');
    const lines = text.split('\n');
    element.replaceChildren(...lines.flatMap((line, index) => [
      line.startsWith('計画高 H = ') ? make('strong', 'formula-answer', line) : document.createTextNode(line),
      ...(index < lines.length - 1 ? [document.createTextNode('\n')] : []),
    ]));
  }

  function targetCalculatorExpression(index) {
    const project = active();
    const distance = Profile.parseStation(project.targets[index], project.spacing);
    const alignment = Profile.buildAlignment(project.points, project.spacing);
    const curve = alignment.curves.find((item) => distance >= item.begin - 1e-9 && distance <= item.end + 1e-9);
    if (curve) {
      const offset = Math.max(0, Math.min(curve.length, distance - curve.begin));
      return formulaNumber(curve.beginHeight) + ' + ' + formulaNumber(curve.incoming) + ' * ' + formulaNumber(offset) + ' + (' + formulaNumber(curve.outgoing) + ' - ' + formulaNumber(curve.incoming) + ') * ' + formulaNumber(offset) + '^2 / (2 * ' + formulaNumber(curve.length) + ')';
    }
    const tangent = alignment.tangents.find((item) => distance < item.end.distance) ?? alignment.tangents.at(-1);
    return formulaNumber(tangent.start.height) + ' + (' + formulaNumber(distance) + ' - ' + formulaNumber(tangent.start.distance) + ') * ' + formulaNumber(tangent.slope);
  }

  function updateDemoControls(enabled) {
    for (const id of ['calculator-demo-back', 'calculator-demo-play', 'calculator-demo-pause', 'calculator-demo-forward']) byId(id).disabled = !enabled;
  }

  function demoSnapshot() {
    return {
      expression: calculatorExpression.value,
      result: byId('calculator-result').textContent,
      value: calculatorExpression.dataset.result,
    };
  }

  function resizeCalculatorExpression() {
    calculatorExpression.style.height = 'auto';
    calculatorExpression.style.height = Math.min(Math.max(calculatorExpression.scrollHeight, 76), 180) + 'px';
  }

  function restoreDemoSnapshot(snapshot) {
    calculatorExpression.value = snapshot.expression;
    resizeCalculatorExpression();
    byId('calculator-result').textContent = snapshot.result;
    if (snapshot.value === undefined) delete calculatorExpression.dataset.result;
    else calculatorExpression.dataset.result = snapshot.value;
  }

  function showDemoProgress(message) {
    const status = byId('calculator-demo-status');
    if (!calculatorDemoActions.length) {
      status.textContent = message || '計算点を入力すると操作を再生できます。';
      return;
    }
    status.textContent = message || ('キー操作 ' + calculatorDemoIndex + ' / ' + calculatorDemoActions.length);
  }

  function prepareCalculatorDemo(expression) {
    pauseCalculatorDemo();
    calculatorDemoExpression = expression;
    calculatorDemoActions = expression ? ['AC', ...Array.from(expression.replace(/\s+/g, ''), (character) => ({ '*': '×', '-': '−' })[character] ?? character), '='] : [];
    calculatorDemoHistory = [];
    calculatorDemoIndex = 0;
    calculatorExpression.value = '';
    resizeCalculatorExpression();
    delete calculatorExpression.dataset.result;
    byId('calculator-result').textContent = '式を入力するか、ボタンを押してください。';
    updateDemoControls(Boolean(expression));
    showDemoProgress(expression ? '再生を押すと、計算式をキー入力して計算します。' : '計算点と入力点を確認してください。');
  }

  function performCalculatorDemoStep() {
    if (calculatorDemoIndex >= calculatorDemoActions.length) {
      pauseCalculatorDemo();
      showDemoProgress('計算完了');
      return false;
    }
    const key = calculatorDemoActions[calculatorDemoIndex];
    const button = calculatorKeyButtons.get(key);
    if (!button) {
      pauseCalculatorDemo();
      showDemoProgress('この式はキー操作に変換できません。');
      return false;
    }
    calculatorDemoHistory[calculatorDemoIndex] = demoSnapshot();
    calculatorDemoActionRunning = true;
    button.classList.add('is-demo-pressed');
    button.click();
    calculatorDemoActionRunning = false;
    setTimeout(() => button.classList.remove('is-demo-pressed'), 180);
    calculatorDemoIndex++;
    showDemoProgress();
    if (calculatorDemoIndex >= calculatorDemoActions.length) {
      pauseCalculatorDemo();
      showDemoProgress('計算完了');
      return false;
    }
    return true;
  }

  function pauseCalculatorDemo() {
    if (calculatorDemoTimer !== null) clearInterval(calculatorDemoTimer);
    calculatorDemoTimer = null;
  }

  function playCalculatorDemo() {
    if (!calculatorDemoActions.length || calculatorDemoTimer !== null) return;
    if (calculatorDemoIndex >= calculatorDemoActions.length) prepareCalculatorDemo(calculatorDemoExpression);
    showDemoProgress('再生中…');
    calculatorDemoTimer = setInterval(() => {
      if (!performCalculatorDemoStep()) pauseCalculatorDemo();
    }, 300);
  }

  function stepCalculatorDemoBack() {
    pauseCalculatorDemo();
    if (calculatorDemoIndex <= 0) return;
    calculatorDemoIndex--;
    restoreDemoSnapshot(calculatorDemoHistory[calculatorDemoIndex]);
    showDemoProgress('1操作戻りました');
  }

  function stepCalculatorDemoForward() {
    pauseCalculatorDemo();
    performCalculatorDemoStep();
  }

  function cancelCalculatorDemoForManualInput() {
    if (calculatorDemoActionRunning || !calculatorDemoActions.length) return;
    pauseCalculatorDemo();
    calculatorDemoActions = [];
    calculatorDemoHistory = [];
    calculatorDemoIndex = 0;
    updateDemoControls(false);
    showDemoProgress('手動で電卓を操作中');
  }

  function openCalculator(index) {
    calculatorTargetIndex = index;
    byId('calculator-context').textContent = '計算点 ' + (index + 1) + '：' + (active().targets[index] || '測点未入力');
    byId('formula-copy-status').textContent = '';
    try {
      renderFormula(targetFormula(index));
      prepareCalculatorDemo(targetCalculatorExpression(index));
    } catch (error) {
      renderFormula('計画高の式を表示できません。\n' + error.message + '\n\n計算点の測点を入力し、入力点を2点以上登録してください。');
      prepareCalculatorDemo('');
    }
    calculatorDialog.showModal();
    calculatorExpression.focus();
  }

  function evaluateExpression(raw) {
    const normalized = raw.normalize('NFKC').replace(/[×]/g, '*').replace(/[÷]/g, '/').replace(/[−]/g, '-').replace(/π/g, 'pi');
    const tokens = normalized.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-zA-Z]+|[()+\-*/^,]/g) ?? [];
    if (!tokens.length || tokens.join('') !== normalized.replace(/\s+/g, '')) throw new Error('式を確認してください。');
    let position = 0;
    const peek = () => tokens[position];
    const take = () => tokens[position++];
    const primary = () => {
      const token = take();
      if (token === '(') {
        const value = expression();
        if (take() !== ')') throw new Error('括弧が閉じていません。');
        return value;
      }
      if (/^(?:\d|\.)/.test(token ?? '')) return Number(token);
      if (token === 'pi') return Math.PI;
      if (token === 'e') return Math.E;
      const functions = { sin: (x) => Math.sin(x * Math.PI / 180), cos: (x) => Math.cos(x * Math.PI / 180), tan: (x) => Math.tan(x * Math.PI / 180), sqrt: Math.sqrt, ln: Math.log, log: Math.log10, abs: Math.abs };
      if (functions[token]) {
        let value;
        if (peek() === '(') {
          take();
          value = expression();
          if (take() !== ')') throw new Error('括弧が閉じていません。');
        } else value = unary();
        return functions[token](value);
      }
      throw new Error('数値、演算子、関数を確認してください。');
    };
    const power = () => { const left = primary(); return peek() === '^' ? (take(), left ** unary()) : left; };
    const unary = () => peek() === '+' ? (take(), unary()) : peek() === '-' ? (take(), -unary()) : power();
    const term = () => { let value = unary(); while (peek() === '*' || peek() === '/') { const operator = take(); const right = unary(); value = operator === '*' ? value * right : value / right; } return value; };
    const expression = () => { let value = term(); while (peek() === '+' || peek() === '-') { const operator = take(); const right = term(); value = operator === '+' ? value + right : value - right; } return value; };
    const value = expression();
    if (position !== tokens.length) throw new Error('式を確認してください。');
    if (!Number.isFinite(value)) throw new Error('計算できる数値の範囲を超えています。');
    return value;
  }

  function runCalculator() {
    try {
      const value = evaluateExpression(calculatorExpression.value);
      byId('calculator-result').textContent = '= ' + Number(value.toPrecision(12)).toString();
      calculatorExpression.dataset.result = String(value);
    } catch (error) {
      byId('calculator-result').textContent = error.message;
      delete calculatorExpression.dataset.result;
    }
  }

  function addCalculatorKeys() {
    const keys = [
      ['sin(', 'function'], ['cos(', 'function'], ['tan(', 'function'], ['√(', 'function'], ['^', 'operator'],
      ['7'], ['8'], ['9'], ['÷', 'operator'], ['(', 'operator'],
      ['4'], ['5'], ['6'], ['×', 'operator'], [')', 'operator'],
      ['1'], ['2'], ['3'], ['−', 'operator'], ['π', 'function'],
      ['0'], ['.'], ['e', 'function'], ['+', 'operator'], ['⌫', 'utility'],
      ['ln(', 'function'], ['log(', 'function'], ['abs(', 'function'], ['AC', 'utility'], ['=', 'equals'],
    ];
    byId('calculator-keys').replaceChildren(...keys.map(([label, type]) => {
      const button = make('button', 'calculator-key' + (type ? ' ' + type : ''), label);
      button.type = 'button';
      button.dataset.calculatorKey = label;
      calculatorKeyButtons.set(label, button);
      button.setAttribute('aria-label', label === '⌫' ? '1文字削除' : label === 'AC' ? 'クリア' : label === '=' ? '計算する' : label);
      button.addEventListener('click', () => {
        cancelCalculatorDemoForManualInput();
        if (label === '=') { runCalculator(); return; }
        if (label === 'AC') { calculatorExpression.value = ''; resizeCalculatorExpression(); delete calculatorExpression.dataset.result; byId('calculator-result').textContent = '式を入力するか、ボタンを押してください。'; calculatorExpression.focus(); return; }
        const start = calculatorExpression.selectionStart ?? calculatorExpression.value.length;
        const end = calculatorExpression.selectionEnd ?? start;
        if (label === '⌫') {
          if (start === end && start > 0) calculatorExpression.setRangeText('', start - 1, end, 'end');
          else calculatorExpression.setRangeText('', start, end, 'end');
        } else calculatorExpression.setRangeText(label === '√(' ? 'sqrt(' : label, start, end, 'end');
        resizeCalculatorExpression();
        delete calculatorExpression.dataset.result;
        calculatorExpression.focus();
      });
      return button;
    }));
  }

  async function copyText(text, status) {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'コピーしました';
    } catch {
      status.textContent = 'コピーできませんでした。テキストを選択してコピーしてください。';
    }
  }

  addCalculatorKeys();
  byId('calculator-demo-back').addEventListener('click', stepCalculatorDemoBack);
  byId('calculator-demo-play').addEventListener('click', playCalculatorDemo);
  byId('calculator-demo-pause').addEventListener('click', () => { pauseCalculatorDemo(); showDemoProgress('一時停止中'); });
  byId('calculator-demo-forward').addEventListener('click', stepCalculatorDemoForward);
  byId('calculator-equals').addEventListener('click', runCalculator);
  calculatorExpression.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); runCalculator(); } });
  calculatorExpression.addEventListener('input', () => { resizeCalculatorExpression(); delete calculatorExpression.dataset.result; cancelCalculatorDemoForManualInput(); });
  byId('copy-formula').addEventListener('click', () => copyText(byId('formula-text').textContent, byId('formula-copy-status')));
  byId('calculator-copy-result').addEventListener('click', () => {
    if (!calculatorExpression.dataset.result) runCalculator();
    if (calculatorExpression.dataset.result) copyText(byId('calculator-result').textContent.replace(/^=\s*/, ''), byId('calculator-copy-status'));
  });
  calculatorDialog.addEventListener('close', () => {
    pauseCalculatorDemo();
    const input = targetRows.children[calculatorTargetIndex]?.querySelector('input');
    input?.focus();
  });

  function drawResults(rows) {
    const tableRows = rows.map((row) => {
      const tr = make('tr');
      tr.dataset.source = row.source;
      const calculated = row.source === 'calculated';
      const source = make('span', 'source-pill' + (calculated ? ' calculated' : ''));
      const dot = make('span', calculated ? 'target-dot' : 'input-dot');
      dot.setAttribute('aria-hidden', 'true');
      source.append(dot, document.createTextNode(calculated ? '計算' : '入力'));
      const sourceCell = make('td', 'source-cell');
      sourceCell.append(source);
      const grade = row.grade === null ? '—' : (row.grade > 0 ? '+' : '') + fixed(row.grade);
      const columns = [
        make('td', 'station', row.station),
        make('td', 'number elevation', fixed(row.height)),
        make('td', 'number chainage', fixed(row.distance)),
        make('td', 'number grade', grade),
        make('td', 'line-type', labels[row.type]),
      ];
      for (const [index, label] of ['測点', '高さ (m)', '累加距離 (m)', '勾配 (%)', '線形'].entries()) {
        columns[index].dataset.label = label;
      }
      tr.append(sourceCell, ...columns);
      return tr;
    });
    byId('result-rows').replaceChildren(...tableRows);
    byId('result-table-wrap').hidden = rows.length === 0;
    byId('results-empty').hidden = rows.length > 0;
    byId('results-count').textContent = rows.length ? rows.length + ' 点' : '';
  }

  function calculate() {
    const project = active();
    let alignment = null;
    let rows = [];
    let errors = [];
    let message = '';
    try {
      alignment = Profile.buildAlignment(project.points, project.spacing);
      ({ rows, errors } = Profile.calculateResults(alignment, project.targets));
    } catch (error) {
      if (project.points.some((point) => point.station.trim() || point.elevation.trim() || point.curveLength.trim())) {
        message = error.message;
      }
    }

    const errorElement = byId('alignment-error');
    errorElement.textContent = message;
    errorElement.hidden = !message;
    byId('metric-length').textContent = alignment ? fixed(alignment.last.distance - alignment.first.distance) : '—';
    byId('metric-input').textContent = alignment?.points.length ?? project.points.filter((point) => point.station.trim() && point.elevation.trim()).length;
    byId('metric-target').textContent = rows.filter((row) => row.source === 'calculated').length;
    const values = new Map(rows.filter((row) => row.source === 'calculated').map((row) => [row.targetIndex, row.height]));
    const problems = new Map(errors.map((error) => [error.index, error.message]));
    for (const [index, row] of Array.from(targetRows.children).entries()) {
      const input = row.querySelector('input');
      const error = row.querySelector('.target-error');
      row.querySelector('output').textContent = values.has(index) ? fixed(values.get(index)) : '';
      error.textContent = problems.get(index) ?? '';
      error.hidden = !problems.has(index);
      if (error.hidden) {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      } else {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', error.id);
      }
    }
    drawResults(rows);
    chart.update(alignment, rows);
  }

  function scheduleCalculation() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      calculate();
    });
  }

  function drawProject() {
    const project = active();
    byId('project-name').textContent = project.name;
    byId('spacing-summary').textContent = '測点間隔 ' + project.spacing + ' m';
    document.title = project.name + '｜高さ計算（縦断）';
    drawProjects();
    drawControls();
    drawTargets();
    calculate();
  }

  function openProjectDialog(create) {
    closeDrawer();
    newMode = create;
    byId('dialog-title').textContent = create ? '新規路線' : '路線設定';
    byId('edit-name').value = create ? '' : active().name;
    byId('edit-spacing').value = create ? '20' : active().spacing;
    byId('settings-tools').hidden = create;
    byId('settings-error').hidden = true;
    byId('submit-project').textContent = create ? '作成' : '保存';
    settingsDialog.showModal();
    byId('edit-name').focus();
  }

  byId('project-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = byId('edit-name').value.trim();
    const spacing = byId('edit-spacing').value.trim();
    try {
      if (!name) throw new Error('路線名を入力してください。');
      Profile.parseStation('No.1', spacing);
      if (newMode) {
        const project = Projects.newProject(name);
        workspace.projects.push(project);
        workspace.activeId = project.id;
      }
      Object.assign(active(), { name, spacing });
      const saved = persist();
      settingsDialog.close();
      drawProject();
      if (saved) toast(newMode ? '路線を作成しました。' : '路線設定を保存しました。');
      if (newMode) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        byId('project-settings').focus({ preventScroll: true });
      }
    } catch (error) {
      const message = byId('settings-error');
      message.textContent = error.message;
      message.hidden = false;
    }
  });

  byId('add-control').addEventListener('click', () => {
    active().points.push(Projects.blankPoint());
    persist();
    drawControls();
    controlRows.lastElementChild.querySelector('input').focus();
  });

  byId('add-target').addEventListener('click', () => {
    active().targets.push('');
    persist();
    drawTargets();
    calculate();
    targetRows.lastElementChild.querySelector('input').focus();
  });

  byId('show-results').addEventListener('click', () => {
    calculate();
    byId('results-title').focus({ preventScroll: true });
    byId('results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
  byId('new-project').addEventListener('click', () => openProjectDialog(true));
  byId('project-settings').addEventListener('click', () => openProjectDialog(false));
  for (const trigger of [byId('top-help'), byId('side-help')]) {
    trigger.addEventListener('click', () => {
      closeDrawer();
      byId('help-dialog').showModal();
    });
  }
  for (const button of document.querySelectorAll('.close-dialog')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  byId('export-project').addEventListener('click', () => {
    const project = active();
    const file = new Blob([Projects.exportProject(project)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = make('a');
    link.href = url;
    link.download = project.name.replace(/[<>:"/\\|?*]/g, '_') + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });

  byId('delete-project').addEventListener('click', () => {
    if (!window.confirm('「' + active().name + '」を削除しますか？')) return;
    workspace.projects = workspace.projects.filter((project) => project.id !== workspace.activeId);
    if (!workspace.projects.length) workspace.projects.push(Projects.newProject());
    workspace.activeId = workspace.projects[0].id;
    const saved = persist();
    settingsDialog.close();
    drawProject();
    if (saved) toast('路線を削除しました。');
  });

  const fileInput = byId('import-file');
  byId('import-project').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const project = Projects.importProject(await file.text());
      workspace.projects.push(project);
      workspace.activeId = project.id;
      const saved = persist();
      closeDrawer(true);
      drawProject();
      window.scrollTo({ top: 0, behavior: 'instant' });
      if (saved) toast('路線を読み込みました。');
    } catch {
      toast('読み込めませんでした。路線バックアップの JSON ファイルを選んでください。');
    } finally {
      fileInput.value = '';
    }
  });

  menuToggle.addEventListener('click', () => {
    if (menuToggle.getAttribute('aria-expanded') === 'true') {
      closeDrawer(true);
      return;
    }
    byId('sidebar').classList.add('is-open');
    byId('drawer-backdrop').hidden = false;
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.setAttribute('aria-label', '路線メニューを閉じる');
    byId('new-project').focus();
  });
  byId('drawer-backdrop').addEventListener('click', () => closeDrawer(true));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) closeDrawer(true);
  });
  matchMedia('(max-width: 900px)').addEventListener('change', () => closeDrawer());

  window.addEventListener('storage', (event) => {
    if (event.key !== Projects.storageKey || !event.newValue) return;
    try {
      const latest = localStorage.getItem(Projects.storageKey);
      if (event.newValue !== latest) return;
      workspace = Projects.readWorkspace(latest);
      drawProject();
    } catch {
      saveStatus('error', '保存した路線を読み込めませんでした。');
    }
  });

  drawProject();
  if (!initialReadError) persist();
})();

