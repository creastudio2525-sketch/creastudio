const test = require('node:test');
const assert = require('node:assert/strict');
const { newProject, sampleProject, readWorkspace, exportProject, importProject } = require('../src/projects.js');

test('restores the selected route with partial inputs intact', () => {
  const sample = sampleProject();
  const project = newProject('北側道路');
  project.spacing = '25';
  project.points[0].station = 'No.3';
  project.targets.push('SP-2.5');
  assert.deepEqual(readWorkspace(JSON.stringify({ activeId: project.id, projects: [sample, project] })), {
    activeId: project.id,
    projects: [sample, project],
  });
});

test('imports a backup as an independent route including inputs and target points', () => {
  const original = sampleProject();
  const restored = importProject(exportProject(original));
  assert.notEqual(restored.id, original.id);
  assert.equal(restored.name, original.name);
  assert.deepEqual(restored.points, original.points);
  assert.deepEqual(restored.targets, original.targets);
});

test('rejects broken backup and workspace data', () => {
  assert.throws(() => importProject('{'));
  assert.throws(() => importProject(JSON.stringify({ version: 1, project: { name: '壊れた路線' } })));
  assert.throws(() => readWorkspace(JSON.stringify({ activeId: 'wrong', projects: [sampleProject()] })));
});

