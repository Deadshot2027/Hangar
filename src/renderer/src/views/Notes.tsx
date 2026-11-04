import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { FileText } from 'lucide-react'
import type { Project } from '@shared/types'
import { api, errMsg } from '../api'
import { Seg, useToast } from '../components/ui'
import { useApp } from '../state'

const TASK = /^(\s*(?:[-*+]|\d+\.)\s+\[)( |x|X)(\])/

/** [[Project name]] becomes a link to that project. */
function withWikiLinks(md: string): string {
  return md.replace(/\[\[([^\]\n]+)\]\]/g, (_m, name: string) => `[${name}](#project:${encodeURIComponent(name.trim())})`)
}

export function toggleTask(md: string, index: number): string {
  let n = -1
  return md
    .split('\n')
    .map((line) => {
      if (!TASK.test(line)) return line
      n++
      return n === index ? line.replace(TASK, (_m, a: string, mark: string, b: string) => `${a}${mark.trim() ? ' ' : 'x'}${b}`) : line
    })
    .join('\n')
}

/** notes.md: rendered by default, plain text when editing. Saves as you type. */
export function Notes({ project }: { project: Project }) {
  const { projects, go } = useApp()
  const toast = useToast()
  const [text, setText] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [saved, setSaved] = useState(true)
  const body = useRef<HTMLDivElement>(null)
  const latest = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    api.readNotes(project.id).then((t) => {
      if (!alive) return
      setText(t)
      latest.current = t
      setMode(t.trim().split('\n').filter(Boolean).length <= 1 ? 'edit' : 'view')
    })
    return () => {
      alive = false
    }
  }, [project.id])

  // Save half a second after typing stops, and on the way out.
  useEffect(() => {
    if (saved || text === null) return
    const t = window.setTimeout(() => {
      api.writeNotes(project.id, text).then(() => setSaved(true)).catch((e) => toast(errMsg(e), false))
    }, 500)
    return () => window.clearTimeout(t)
  }, [text, saved, project.id, toast])
  useEffect(
    () => () => {
      if (latest.current !== null) void api.writeNotes(project.id, latest.current)
    },
    [project.id]
  )

  const change = (t: string) => {
    setText(t)
    latest.current = t
    setSaved(false)
  }

  const html = useMemo(() => {
    if (text === null) return ''
    const raw = marked.parse(withWikiLinks(text), { gfm: true, async: false }) as string
    return DOMPurify.sanitize(raw)
  }, [text])

  // Checkboxes in the rendered note tick the matching "- [ ]" line.
  useEffect(() => {
    if (mode !== 'view' || !body.current) return
    body.current.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box, i) => {
      box.disabled = false
      box.onclick = (e) => {
        e.preventDefault()
        if (latest.current !== null) change(toggleTask(latest.current, i))
      }
    })
  }, [html, mode])

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href') || ''
    if (href.startsWith('#project:')) {
      const name = decodeURIComponent(href.slice(9)).toLowerCase()
      const target = projects.find((p) => p.name.toLowerCase() === name || p.id === name)
      if (target) go({ kind: 'project', id: target.id, tab: 'notes' })
      else toast(`No project called “${decodeURIComponent(href.slice(9))}”.`, false)
    } else if (/^https?:\/\//.test(href)) void api.openUrl(href)
  }

  return (
    <article className="frame" style={{ maxWidth: 820 }}>
      <div className="frame-sub" style={{ borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--tx3)', gap: 8 }}>
        <FileText size={13} />
        <span className="mono dim" style={{ fontSize: 11.5 }}>notes.md</span>
        <span>· {saved ? 'Saved' : 'Saving…'}</span>
        <span className="grow" />
        <Seg label="Notes mode" value={mode} onChange={setMode} options={[{ value: 'view', label: 'Read' }, { value: 'edit', label: 'Edit' }]} />
      </div>
      {text === null ? null : mode === 'edit' ? (
        <textarea
          className="notes-editor"
          aria-label="Notes"
          value={text}
          onChange={(e) => change(e.target.value)}
          placeholder={'# Ideas, decisions and next steps\n\n- [ ] A task\n- Link another project with [[Its name]]'}
          spellCheck
          autoFocus
        />
      ) : text.trim() ? (
        <div ref={body} className="notes-body" onClick={onClick} onDoubleClick={() => setMode('edit')} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="notes-body">
          <p className="muted">
            Nothing here yet.{' '}
            <button type="button" className="link" onClick={() => setMode('edit')}>
              Start writing
            </button>
          </p>
        </div>
      )}
    </article>
  )
}
