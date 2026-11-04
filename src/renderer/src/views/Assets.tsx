import { useState, type DragEvent } from 'react'
import { Box, File, FileText, Film, Folder, Plus } from 'lucide-react'
import type { Project } from '@shared/types'
import { api, errMsg } from '../api'
import { useToast } from '../components/ui'
import { useApp } from '../state'
import { bytes, cx, tildify, useAsync } from '../util'

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i
const MODEL = /\.(glb|gltf|usdz|obj|fbx|blend|stl|3mf)$/i
const DOC = /\.(pdf|md|txt|docx?|key|pages)$/i

function kindOf(name: string, isDir: boolean): string {
  if (isDir) return 'Folder'
  if (IMAGE.test(name)) return 'Image'
  if (VIDEO.test(name)) return 'Video'
  if (MODEL.test(name)) return '3D model'
  if (DOC.test(name)) return 'Document'
  return name.includes('.') ? name.split('.').pop()!.toUpperCase() : 'File'
}

/** Big files that belong to the project but not in git: designs, videos, 3D models. */
export function Assets({ project }: { project: Project }) {
  const { home } = useApp()
  const toast = useToast()
  const [version, setVersion] = useState(0)
  const [dropping, setDropping] = useState(false)
  const list = useAsync(() => api.listAssets(project.id), [project.id, version])
  const dir = `${project.home}/assets`

  const add = async (paths: string[]) => {
    if (!paths.length) return
    try {
      const r = await api.addAssets(project.id, paths)
      toast(r.message, r.ok)
      setVersion((v) => v + 1)
    } catch (e) {
      toast(errMsg(e), false)
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDropping(false)
    void add([...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean))
  }

  return (
    <div
      className={cx(dropping && 'dropping')}
      style={{ borderRadius: 8 }}
      onDragOver={(e) => {
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <span className="mono dim" style={{ fontSize: 11.5 }}>{tildify(dir, home)}</span>
        <span className="muted" style={{ fontSize: 12 }}>· Not tracked by git</span>
        <span className="grow" />
        <button type="button" className="btn" onClick={() => api.openPath(dir)}>Show in Finder</button>
      </div>
      <div className="asset-grid">
        {(list.data || []).map((a) => {
          const abs = `${dir}/${a.path}`
          const kind = kindOf(a.name, a.isDir)
          return (
            <button key={a.path} type="button" className="asset" onClick={() => api.openPath(abs)} onContextMenu={() => api.revealPath(abs)} title="Open · right-click to show in Finder">
              <span className="thumb" aria-hidden="true">
                {kind === 'Image' ? (
                  <img src={`asset://local${encodeURI(abs)}`} alt="" loading="lazy" />
                ) : kind === 'Video' ? (
                  <Film size={24} strokeWidth={1.5} />
                ) : kind === '3D model' ? (
                  <Box size={24} strokeWidth={1.5} />
                ) : kind === 'Folder' ? (
                  <Folder size={24} strokeWidth={1.5} />
                ) : kind === 'Document' ? (
                  <FileText size={24} strokeWidth={1.5} />
                ) : (
                  <File size={24} strokeWidth={1.5} />
                )}
              </span>
              <span className="meta">
                <span className="ellipsis" style={{ fontSize: 12.5, fontWeight: 500 }}>{a.name}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>{kind}{a.isDir ? '' : ` · ${bytes(a.size)}`}</span>
              </span>
            </button>
          )
        })}
        <button
          type="button"
          className="asset"
          style={{ minHeight: 168, borderStyle: 'dashed', borderColor: 'var(--line2)', background: 'transparent', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--tx3)', fontSize: 12.5 }}
          onClick={async () => add(await api.pickFiles())}
        >
          <Plus size={18} />
          Add or drop designs, videos, 3D models
        </button>
      </div>
    </div>
  )
}
