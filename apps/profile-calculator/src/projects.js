'use strict';

const Projects = (() => {
  const version = 1;
  const storageKey = 'creastudio-vertical-profile-v1';
  const blankPoint = () => ({ station: '', elevation: '', curveLength: '' });

  function id() {
    return globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function newProject(name = '無題の路線') {
    return { id: id(), name, spacing: '20', points: [blankPoint(), blankPoint()], targets: ['', ''], sample: false };
  }

  function sampleProject() {
    return {
      ...newProject('サンプル路線'),
      sample: true,
      points: [
        { station: 'SP0', elevation: '102.400', curveLength: '' },
        { station: 'SP80', elevation: '105.600', curveLength: '60' },
        { station: 'SP180', elevation: '103.100', curveLength: '80' },
        { station: 'SP280', elevation: '106.600', curveLength: '' },
      ],
      targets: ['SP-20', 'SP40', 'SP80', 'SP120', 'SP180', 'SP230', 'SP310'],
    };
  }

  function checkedProject(project) {
    const isText = (value) => typeof value === 'string';
    if (!project || !isText(project.id) || !project.id || !isText(project.name) || !project.name.trim()
      || !isText(project.spacing) || typeof project.sample !== 'boolean'
      || !Array.isArray(project.points) || !project.points.every((point) => point && [point.station, point.elevation, point.curveLength].every(isText))
      || !Array.isArray(project.targets) || !project.targets.every(isText)) {
      throw new Error('路線データの形式を確認してください。');
    }
    return {
      id: project.id, name: project.name, spacing: project.spacing, sample: project.sample,
      points: project.points.map(({ station, elevation, curveLength }) => ({ station, elevation, curveLength })),
      targets: [...project.targets],
    };
  }

  function readWorkspace(raw) {
    if (raw === null) {
      const sample = sampleProject();
      return { activeId: sample.id, projects: [sample] };
    }
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.projects)) throw new Error('保存した路線を読み込めませんでした。');
    const projects = data.projects.map(checkedProject);
    if (new Set(projects.map((project) => project.id)).size !== projects.length || !projects.some((project) => project.id === data.activeId)) {
      throw new Error('保存した路線を読み込めませんでした。');
    }
    return { activeId: data.activeId, projects };
  }

  function exportProject(project) {
    return JSON.stringify({ version, project }, null, 2);
  }

  function importProject(raw) {
    const data = JSON.parse(raw);
    if (data?.version !== version) throw new Error('対応する路線バックアップを選択してください。');
    return { ...checkedProject(data.project), id: id(), sample: false };
  }

  return { storageKey, blankPoint, newProject, sampleProject, readWorkspace, exportProject, importProject };
})();

if (typeof module !== 'undefined') module.exports = Projects;

