/** webview <-> extension host 的消息协议。两端共用，避免字段名漂移。 */

export interface RepoState {
  /** 仓库根目录绝对路径 */
  root: string
  /** 仓库显示名（目录名） */
  name: string
  /** 当前 HEAD 分支名；detached HEAD 时是短 hash */
  branch: string
  /** HEAD 是否为 detached 状态 */
  detached: boolean
  /** 当前分支是否命中 PCMP 关键字 */
  isPcmp: boolean
  /** 从分支名解析出的单号，如 PCMP-123；未命中为 null */
  ticket: string | null
  /** 暂存区文件数 */
  staged: number
  /** 已修改但未暂存的文件数 */
  unstaged: number
  /** 未跟踪文件数 */
  untracked: number
  /** 当前分支的上游，如 origin/dev；没有则为 null */
  upstream: string | null
  /** 相对上游的领先提交数 */
  ahead: number
  /** 相对上游的落后提交数 */
  behind: number
}

export interface BaseBranch {
  /** 短名，如 dev、master */
  name: string
  /** 远端名，如 origin、to_dev；本地分支为 '' */
  remote: string
  /** 远端完整引用，如 origin/dev */
  ref: string
  /** 最近一次提交时间（ISO 字符串） */
  date: string
  /** 是否为远端分支 */
  isRemote: boolean
}

export interface RepoListPayload {
  repos: RepoState[]
  /** 当前 VS Code 活动文件所属的仓库根路径 */
  activeRoot: string | null
  /** prepare-commit-msg 钩子的安装状态（全局 scope） */
  hook: HookStatus
}

export interface HookStatus {
  /** core.hooksPath 当前指向，未设置为 null */
  hooksPath: string | null
  /** 是否已指向本插件的 hook 目录 */
  installed: boolean
  /** 钩子文件是否与插件内置版本一致 */
  upToDate: boolean
}

/** webview -> extension host */
export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'selectRepo'; root: string }
  | {
      type: 'commit'
      root: string
      summary: string
      description: string
      amend: boolean
      /** 提交成功后是否立刻推送当前分支 */
      push: boolean
      requestId: string
    }
  | { type: 'loadBases'; root: string; requestId: string }
  | { type: 'createBranch'; root: string; name: string; base: string; pushRemote: string; requestId: string }
  | { type: 'push'; root: string; requestId: string }
  | { type: 'installHook'; scope: 'global' | 'repo'; root: string; requestId: string }
  | { type: 'uninstallHook'; root: string; requestId: string }
  | { type: 'openRepoInScm'; root: string }
  | { type: 'revealFile'; root: string; path: string }

/** extension host -> webview */
export type HostToWebview =
  | { type: 'repos'; payload: RepoListPayload }
  | { type: 'bases'; root: string; bases: BaseBranch[]; defaultBase: string; requestId: string }
  | { type: 'busy'; root: string; busy: boolean; label?: string }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string; requestId?: string; ok?: boolean }
  | { type: 'prefillCommit'; root: string; summary: string; description: string }
  | { type: 'error'; message: string }

let seq = 0
/** 生成请求 id，用于把异步结果对回到具体的操作 */
export function nextRequestId(): string {
  seq += 1
  return `req-${Date.now().toString(36)}-${seq}`
}
