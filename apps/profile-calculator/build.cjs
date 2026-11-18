const fs = require('node:fs');
const path = require('node:path');

const readSource = (file, encoding) => fs.readFileSync(path.join(__dirname, 'src', file), encoding);
const inlinePng = (file) => 'data:image/png;base64,' + readSource('assets/' + file).toString('base64');
const script = ['profile.js', 'projects.js', 'chart.js', 'app.js'].map((file) => readSource(file, 'utf8')).join('\n\n');
const html = readSource('index.html', 'utf8')
  .replaceAll('{{MARK}}', () => inlinePng('creastudio-mark.png'))
  .replace('{{LOGO}}', () => inlinePng('creastudio-logo.png'))
  .replace('/*{{STYLE}}*/', () => readSource('style.css', 'utf8'))
  .replace('/*{{SCRIPT}}*/', () => script);

const output = path.join(__dirname, 'dist');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'index.html'), html, 'utf8');
console.log(path.join(output, 'index.html'));

