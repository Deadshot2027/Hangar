import type { Project } from '@shared/types'
import { api, errMsg } from '../api'
import { STATUS_LABEL, STATUS_ORDER, StatusIcon, useToast } from '../components/ui'
import { useApp, type Tab } from '../state'
import { cx } from '../util'
import { Assets } from './Assets'
import { Notes } from './Notes'
import { Overview } from './Overview'
import { Preview } from './Preview'
import { ProjectSettings } from './ProjectSettings'
import { Repository } from './Repository'
import { LaunchButton } from './Shell'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'preview', label: 'Preview' },
  { key: 'notes', label: 'Notes' },
  { key: 'repo', label: 'Repository' },
  { key: 'assets', label: 'Assets' },
  { key: 'settings', label: 'Settings' }
]

export function ProjectPage({ project, tab }: { project: Project; tab: Tab }) {
  const { go, statuses, live, refresh } = useApp()
  const toast = useToast()
  const changes = statuses[project.id]?.changes.length ?? 0

  const cycleStatus = async () => {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(project.status) + 1) % STATUS_ORDER.length]
    try {
      await api.updateProject(project.id, { status: next })
      await refresh()
    } catch (e) {
      toast(errMsg(e), false)
    }
  }

  return (
    <>
      <div className="proj-head">
        <div className="row wrap" style={{ gap: 10 }}>
          <h1>{project.name}</h1>
          <button type="button" className="chip" onClick={cycleStatus} title="Change status">
            <StatusIcon status={project.status} size={12} />
            {STATUS_LABEL[project.status]}
          </button>
          {!project.codeExists && project.codePath && <span className="chip" style={{ color: 'var(--warn)' }}>Code folder missing</span>}
          <span className="grow" />
          <LaunchButton project={project} />
        </div>
        {project.description && <p>{project.description}</p>}
        <nav className="tabs" aria-label="Project sections" style={{ marginTop: 14 }}>
          {TABS.map((t) => (
            <button key={t.key} type="button" className={cx(tab === t.key && 'on')} aria-current={tab === t.key ? 'page' : undefined} onClick={() => go({ kind: 'project', id: project.id, tab: t.key })}>
              {t.label}
              {t.key === 'repo' && changes > 0 && <span className="badge">{changes}</span>}
              {t.key === 'preview' && live?.id === project.id && <span className="live-dot" aria-label="Preview live" />}
            </button>
          ))}
        </nav>
      </div>
      <div className="page">
        {tab === 'overview' && <Overview project={project} />}
        {tab === 'preview' && <Preview project={project} />}
        {tab === 'notes' && <Notes project={project} />}
        {tab === 'repo' && <Repository project={project} />}
        {tab === 'assets' && <Assets project={project} />}
        {tab === 'settings' && <ProjectSettings project={project} />}
      </div>
    </>
  )
}
