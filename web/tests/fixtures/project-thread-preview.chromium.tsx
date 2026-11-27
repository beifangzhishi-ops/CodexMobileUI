import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  PROJECT_THREAD_PREVIEW_LIMIT, clearProjectThreadLimit, nextProjectThreadLimit,
  visibleProjectThreads,
} from '../../src/projectThreadVisibility';

const makeRows = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({
  id: `${prefix}-thread-${index + 1}`, title: `${prefix} 对话 ${index + 1}`,
}));
const projects = [
  { key: '6v:project-1', name: 'Alpha', rows: makeRows('6v-alpha', 23) },
  { key: '6v:project-2', name: 'Beta', rows: makeRows('6v-beta', 20) },
  { key: 'noha:project-1', name: 'Alpha noha', rows: makeRows('noha-alpha', 12) },
];

function App() {
  const [opened, setOpened] = useState<string[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [activeThread, setActiveThread] = useState('initial-thread');
  function toggleProject(key: string) {
    const closing = opened.includes(key);
    setOpened((current) => closing
      ? current.filter((item) => item !== key)
      : current.includes(key) ? current : [...current, key]);
    if (closing) setLimits((current) => clearProjectThreadLimit(current, key));
  }
  return <main className="sidebar" data-active-thread={activeThread} data-list-loads="1">
    <h1>项目</h1>
    {projects.map((project) => {
      const expanded = opened.includes(project.key);
      const limit = limits[project.key] ?? PROJECT_THREAD_PREVIEW_LIMIT;
      const visible = visibleProjectThreads(project.rows, limit);
      return <section key={project.key} className="project" data-project={project.key}>
        <header className="project-line">
          <button className="project-disclosure" aria-label={`${expanded ? '收起' : '展开'} ${project.name}`}
            aria-expanded={expanded} onClick={() => toggleProject(project.key)}>›</button>
          <button className="project-name" onClick={() => toggleProject(project.key)}>{project.name}</button>
        </header>
        {expanded && <div className="nested-conversations">
          {visible.map((row) => <button className="conversation-row" key={row.id}
            onClick={() => setActiveThread(row.id)}>{row.title}</button>)}
          {project.rows.length > limit && <button className="project-thread-toggle"
            onClick={() => setLimits((current) => ({ ...current, [project.key]:
              nextProjectThreadLimit(current[project.key] ?? PROJECT_THREAD_PREVIEW_LIMIT, project.rows.length),
            }))}>加载更多对话</button>}
        </div>}
      </section>;
    })}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App/>);
