import { useEffect, useMemo, useRef, useState } from 'react'
import { bridge } from './bridge'
import type { BaseBranch, HookStatus, HostToWebview, RepoState } from '@shared/protocol'

interface Notice {
  level: 'info' | 'warn' | 'error'
  message: string
}

export default function App() {
  const [repos, setRepos] = useState<RepoState[]>([])
  const [activeRoot, setActiveRoot] = useState<string | null>(null)
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [amend, setAmend] = useState(false)

  const [bases, setBases] = useState<BaseBranch[]>([])
  const [baseRef, setBaseRef] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [hook, setHook] = useState<HookStatus | null>(null)

  /** 记住当前操作 id：扩展侧返回的结果只对得上自己发起的请求时才提示 */
  const pendingCommit = useRef<string | null>(null)
  const pendingBases = useRef<string | null>(null)

  useEffect(() => {
    const off = bridge.subscribe((msg: HostToWebview) => {
      switch (msg.type) {
        case 'repos':
          setRepos(msg.payload.repos)
          setActiveRoot(msg.payload.activeRoot)
          setHook(msg.payload.hook)
          setSelectedRoot((prev) =>
            prev && msg.payload.repos.some((r) => r.root === prev) ? prev : msg.payload.activeRoot,
          )
          break

        case 'bases':
          if (pendingBases.current !== msg.requestId) break
          pendingBases.current = null
          setBases(msg.bases)
          setBaseRef(msg.defaultBase)
          break

        case 'busy':
          setBusyLabel(msg.busy ? (msg.label ?? '处理中') : null)
          break

        case 'notice':
          if (msg.requestId && msg.requestId !== pendingCommit.current && !msg.ok) break
          setNotice({ level: msg.level, message: msg.message })
          if (msg.ok && msg.requestId === pendingCommit.current) {
            pendingCommit.current = null
            setSummary('')
            setDescription('')
            setAmend(false)
          }
          break

        case 'prefillCommit':
          if (msg.summary) setSummary(msg.summary)
          if (msg.description) setDescription(msg.description)
          break

        case 'error':
          setNotice({ level: 'error', message: msg.message })
          break
      }
    })
    bridge.post({ type: 'ready' })
    return off
  }, [])

  const repo = useMemo(
    () => repos.find((r) => r.root === (selectedRoot ?? activeRoot)) ?? repos[0],
    [repos, selectedRoot, activeRoot],
  )

  // 切仓库时重新拉基线列表，并清掉上一个仓库的输入
  useEffect(() => {
    if (!repo) return
    setBases([])
    setBaseRef('')
    setNewBranch('')
    const requestId = `bases-${repo.root}`
    pendingBases.current = requestId
    bridge.post({ type: 'loadBases', root: repo.root, requestId })
  }, [repo?.root])

  const prefix = repo?.ticket ? `${repo.ticket}: ` : repo?.isPcmp ? `${repo?.branch}: ` : ''

  const submit = (andPush: boolean) => {
    if (!repo || !summary.trim() || busyLabel) return
    const requestId = `c-${Date.now().toString(36)}`
    pendingCommit.current = requestId
    bridge.post({ type: 'commit', root: repo.root, summary, description, amend, requestId, push: andPush })
  }

  const createBranch = () => {
    if (!repo || !newBranch.trim() || busyLabel) return
    bridge.post({
      type: 'createBranch',
      root: repo.root,
      name: newBranch.trim(),
      base: baseRef,
      pushRemote: '',
      requestId: `nb-${Date.now().toString(36)}`,
    })
  }

  if (repos.length === 0) {
    return (
      <div className="empty">
        <p>未发现 git 仓库。</p>
        <button onClick={() => bridge.post({ type: 'refresh' })}>重新扫描</button>
      </div>
    )
  }

  return (
    <div className="app">
      {repos.length > 1 && (
        <select
          className="repoSelect"
          value={repo?.root ?? ''}
          onChange={(e) => {
            setSelectedRoot(e.target.value)
            bridge.post({ type: 'selectRepo', root: e.target.value })
          }}
        >
          {repos.map((r) => (
            <option key={r.root} value={r.root}>
              {r.name} · {r.branch}
            </option>
          ))}
        </select>
      )}

      {repo && (
        <>
          <section className={`branchBox ${repo.isPcmp ? 'hit' : ''}`}>
            <div className="row">
              <span className="label">当前分支</span>
              <code className="branch">{repo.branch}</code>
              {repo.detached && <span className="tag warn">detached</span>}
            </div>
            <div className="row">
              <span className="label">提交前缀</span>
              {prefix ? <code className="prefix">{prefix}</code> : <span className="muted">分支不含 PCMP，忽略</span>}
            </div>
            <div className="row">
              <span className="label">工作区</span>
              <span className="muted">
                暂存 {repo.staged} · 未暂存 {repo.unstaged} · 未跟踪 {repo.untracked}
                {repo.upstream && (
                  <>
                    {' · '}
                    {repo.upstream}
                    {repo.ahead > 0 && ` ↑${repo.ahead}`}
                    {repo.behind > 0 && ` ↓${repo.behind}`}
                  </>
                )}
              </span>
            </div>
          </section>

          <section className="panel">
            <h3>提交</h3>
            <input
              className="summary"
              placeholder="提交信息"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(false)
              }}
            />
            {prefix && summary.trim() && (
              <div className="preview">
                实际提交：<code>{`${prefix}${summary.trim()}`}</code>
              </div>
            )}
            <textarea
              className="description"
              placeholder="正文（可选）"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <label className="check">
              <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
              amend 上一条提交
            </label>
            <div className="actions">
              <button className="primary" disabled={!!busyLabel || !summary.trim()} onClick={() => submit(false)}>
                提交
              </button>
              <button disabled={!!busyLabel || !summary.trim()} onClick={() => submit(true)}>
                提交并推送
              </button>
            </div>
          </section>

          <section className="panel">
            <h3>命令行提交</h3>
            <div className="row">
              <span className="label">钩子状态</span>
              {hook?.installed ? (
                <span className="muted">
                  已安装{hook.upToDate ? '' : '（版本较旧，建议重装）'}
                </span>
              ) : (
                <span className="muted">未安装，命令行 git commit 不会加前缀</span>
              )}
            </div>
            {hook?.hooksPath && <div className="preview">core.hooksPath: {hook.hooksPath}</div>}
            <div className="actions">
              <button
                className={hook?.installed ? '' : 'primary'}
                disabled={!!busyLabel}
                onClick={() => bridge.post({ type: 'installHook', scope: 'global', root: repo.root, requestId: `hg-${Date.now().toString(36)}` })}
              >
                全局安装
              </button>
              <button
                disabled={!!busyLabel}
                onClick={() => bridge.post({ type: 'installHook', scope: 'repo', root: repo.root, requestId: `hr-${Date.now().toString(36)}` })}
              >
                仅本仓库
              </button>
              {hook?.installed && (
                <button
                  disabled={!!busyLabel}
                  onClick={() => bridge.post({ type: 'uninstallHook', root: repo.root, requestId: `hu-${Date.now().toString(36)}` })}
                >
                  卸载
                </button>
              )}
            </div>
          </section>

          <section className="panel">
            <h3>新建分支</h3>
            <input
              className="newBranch"
              placeholder="分支名，例如 dev/PCMP-123"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
            />
            <select className="baseSelect" value={baseRef} onChange={(e) => setBaseRef(e.target.value)}>
              {bases.length === 0 && <option value="">（基线读取中）</option>}
              {bases.map((b) => (
                <option key={`${b.remote}|${b.ref}`} value={b.ref}>
                  {b.isRemote ? b.ref : `（本地）${b.ref}`}
                </option>
              ))}
            </select>
            <div className="actions">
              <button className="primary" disabled={!!busyLabel || !newBranch.trim() || !baseRef} onClick={createBranch}>
                创建并推送
              </button>
              <button
                disabled={!!busyLabel || !repo.upstream}
                onClick={() => bridge.post({ type: 'push', root: repo.root, requestId: `p-${Date.now().toString(36)}` })}
              >
                推送当前分支
              </button>
            </div>
          </section>
        </>
      )}

      {busyLabel && <div className="busy">{busyLabel}…</div>}
      {notice && (
        <div className={`notice ${notice.level}`} onClick={() => setNotice(null)}>
          {notice.message}
        </div>
      )}
    </div>
  )
}
