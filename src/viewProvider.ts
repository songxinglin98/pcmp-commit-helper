import * as vscode from 'vscode'
import { findRepoRoot, readRepoState } from './git/repo'
import { createAndPushBranch, commit } from './git/actions'
import { git, isValidBranchName, listRemoteBranches } from './git/exec'
import { applyPrefix, resolvePrefix } from '@shared/pcmpPrefix'
import { installHook, readHookStatus, uninstallHook, defaultHooksDir } from './git/hookInstaller'
import type {
  BaseBranch,
  HostToWebview,
  RepoListPayload,
  RepoState,
  WebviewToHost,
} from '@shared/protocol'

const KEYWORD_KEY = 'pcmpCommitHelper.branchKeyword'
const BASE_KEY = 'pcmpCommitHelper.defaultBase'

function keyword(): string {
  return vscode.workspace.getConfiguration().get<string>(KEYWORD_KEY, 'PCMP')
}

function configuredBase(): string {
  return vscode.workspace.getConfiguration().get<string>(BASE_KEY, '').trim()
}

interface GitExtension {
  getAPI(version: 1): { repositories: { rootUri: vscode.Uri }[] }
}

/**
 * 发现候选仓库。
 *
 * 优先用 VS Code 内置 git 扩展的仓库列表——它已经处理好了 workspace 里嵌套仓库、
 * worktree、以及用户手动添加过的仓库。内置扩展不可用时，退化为扫描 workspace 目录。
 */
async function discoverRepoRoots(): Promise<string[]> {
  const roots = new Set<string>()

  try {
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git')
    if (ext) {
      if (!ext.isActive) await ext.activate()
      const api = ext.exports?.getAPI?.(1)
      for (const repo of api?.repositories ?? []) {
        roots.add(repo.rootUri.fsPath)
      }
    }
  } catch {
    // 内置 git 扩展缺失时继续走目录扫描
  }

  if (roots.size === 0) {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const root = await findRepoRoot(folder.uri.fsPath)
      if (root) roots.add(root)
    }
  }

  return [...roots]
}

/** 当前活动文件所属仓库，用于面板默认选中项 */
function activeRepoRoot(known: string[]): string | null {
  const active = vscode.window.activeTextEditor?.document.uri
  if (!active || active.scheme !== 'file') return known[0] ?? null
  const best = known
    .filter((root) => active.fsPath.startsWith(root))
    .sort((a, b) => b.length - a.length)[0]
  return best ?? known[0] ?? null
}

export class PcmpViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'pcmpCommitHelper.view'

  private view: vscode.WebviewView | undefined
  private repos: RepoState[] = []
  private selectedRoot: string | null = null

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly buildHtml: (webview: vscode.Webview) => string,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
      ],
    }
    view.webview.html = this.buildHtml(view.webview)
    view.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      void this.onMessage(msg)
    })
    view.onDidDispose(() => {
      this.view = undefined
    })
    void this.refresh()
  }

  async refresh(): Promise<void> {
    const roots = await discoverRepoRoots()
    const states: RepoState[] = []
    for (const root of roots) {
      try {
        states.push(await readRepoState(root, keyword()))
      } catch {
        // 单个仓库读取失败不影响其他仓库展示
      }
    }
    this.repos = states

    const active = activeRepoRoot(roots)
    if (!this.selectedRoot || !roots.includes(this.selectedRoot)) {
      this.selectedRoot = active
    }

    const hook = await readHookStatus(this.extensionUri, this.selectedRoot)

    this.post({
      type: 'repos',
      payload: { repos: states, activeRoot: this.selectedRoot, hook } satisfies RepoListPayload,
    })

    // 刷新后把选中仓库的最新状态回填到提交框上方，避免界面停留在旧分支
    const current = this.selectedRepo()
    if (current?.isPcmp) {
      const prefix = resolvePrefix(current.branch, keyword())
      this.post({
        type: 'prefillCommit',
        root: current.root,
        summary: '',
        description: prefix.prefix ? `# ${prefix.reason}` : '',
      })
    }
  }

  private selectedRepo(): RepoState | undefined {
    return this.repos.find((r) => r.root === this.selectedRoot) ?? this.repos[0]
  }

  private post(msg: HostToWebview): void {
    void this.view?.webview.postMessage(msg)
  }

  private busy(root: string, busy: boolean, label?: string): void {
    this.post({ type: 'busy', root, busy, label })
  }

  private notice(
    level: 'info' | 'warn' | 'error',
    message: string,
    requestId?: string,
    ok?: boolean,
  ): void {
    this.post({ type: 'notice', level, message, requestId, ok })
  }

  private async onMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        await this.refresh()
        return

      case 'selectRepo':
        this.selectedRoot = msg.root
        await this.refresh()
        return

      case 'commit':
        await this.handleCommit(msg)
        return

      case 'loadBases':
        await this.handleLoadBases(msg.root, msg.requestId)
        return

      case 'createBranch':
        await this.handleCreateBranch(msg)
        return

      case 'push':
        await this.handlePush(msg.root, msg.requestId)
        return

      case 'installHook':
        await this.handleInstallHook(msg)
        return

      case 'uninstallHook':
        await this.handleUninstallHook(msg.root, msg.requestId)
        return

      case 'openRepoInScm':
        await this.openScm(msg.root)
        return

      default:
        return
    }
  }

  private async handleCommit(msg: Extract<WebviewToHost, { type: 'commit' }>): Promise<void> {
    this.busy(msg.root, true, msg.push ? '提交并推送' : '提交中')
    try {
      const state = this.repos.find((r) => r.root === msg.root) ?? (await this.readState(msg.root))
      if (state.detached) {
        throw new Error('当前处于 detached HEAD，请先切到一个分支再提交')
      }

      const prefix = resolvePrefix(state.branch, keyword())
      const summary = applyPrefix(msg.summary, prefix)

      await commit({
        root: msg.root,
        summary,
        description: msg.description,
        amend: msg.amend,
      })

      if (msg.push) {
        await this.pushBranch(msg.root, state)
      }

      this.notice(
        'info',
        msg.push ? `已提交并推送：${summary}` : `已提交：${summary}`,
        msg.requestId,
        true,
      )
      await this.refresh()
    } catch (err) {
      this.notice('error', describe(err), msg.requestId, false)
    } finally {
      this.busy(msg.root, false)
    }
  }

  /** 推送当前分支；无上游时自动补一次 --set-upstream，省去用户手敲 */
  private async pushBranch(root: string, state: RepoState): Promise<void> {
    if (state.upstream) {
      await git(root, ['push'], { timeout: 180_000 })
      return
    }
    const remote = inferRemote(state, '')
    await git(root, ['push', '--set-upstream', remote, state.branch], { timeout: 180_000 })
  }

  private async handleLoadBases(root: string, requestId: string): Promise<void> {
    try {
      const remoteRefs = await listRemoteBranches(root)
      const bases: BaseBranch[] = remoteRefs.map((r) => ({
        name: r.name,
        remote: r.remote,
        ref: r.ref,
        date: r.date,
        isRemote: true,
      }))

      // 加上本地分支，方便以本地分支为基线
      const seen = new Set(bases.map((b) => `${b.remote}/${b.name}`))
      const state = this.repos.find((r) => r.root === root)
      if (state) {
        const localName = state.branch
        if (localName && !seen.has(`local/${localName}`)) {
          bases.unshift({
            name: localName,
            remote: '',
            ref: localName,
            date: new Date().toISOString(),
            isRemote: false,
          })
        }
      }

      this.post({
        type: 'bases',
        root,
        bases,
        defaultBase: pickDefaultBase(bases, configuredBase()),
        requestId,
      })
    } catch (err) {
      this.notice('error', `读取基线分支失败：${describe(err)}`, requestId, false)
    }
  }

  private async handleCreateBranch(msg: Extract<WebviewToHost, { type: 'createBranch' }>): Promise<void> {
    this.busy(msg.root, true, '创建分支')
    try {
      const state = this.repos.find((r) => r.root === msg.root) ?? (await this.readState(msg.root))

      if (!(await isValidBranchName(msg.root, msg.name))) {
        throw new Error(`"${msg.name}" 不是合法的 git 分支名`)
      }

      const remote = msg.pushRemote || inferRemote(state, msg.base)
      const result = await createAndPushBranch({
        root: msg.root,
        name: msg.name,
        base: msg.base,
        pushRemote: remote,
      })

      this.notice('info', `已创建 ${result.branch}（基线 ${result.base || 'HEAD'}）并推送到 ${remote}`, msg.requestId, true)
      await this.refresh()
    } catch (err) {
      this.notice('error', describe(err), msg.requestId, false)
    } finally {
      this.busy(msg.root, false)
    }
  }

  private async handlePush(root: string, requestId: string): Promise<void> {
    this.busy(root, true, '推送中')
    try {
      const state = this.repos.find((r) => r.root === root) ?? (await this.readState(root))
      if (state.detached) throw new Error('detached HEAD 状态下无法推送')
      if (!state.upstream) {
        throw new Error(`分支 ${state.branch} 没有上游，请先推送一次并设置上游`)
      }
      await git(root, ['push'], { timeout: 180_000 })
      this.notice('info', `已推送 ${state.branch} → ${state.upstream}`, requestId, true)
      await this.refresh()
    } catch (err) {
      this.notice('error', describe(err), requestId, false)
    } finally {
      this.busy(root, false)
    }
  }

  private async readState(root: string): Promise<RepoState> {
    return readRepoState(root, keyword())
  }

  /**
   * 安装 prepare-commit-msg 钩子。
   * 覆盖命令行 `git commit`（插件内提交不经过钩子，两条路径前缀规则一致，互不冲突）。
   */
  private async handleInstallHook(msg: Extract<WebviewToHost, { type: 'installHook' }>): Promise<void> {
    const scope = msg.scope === 'global' ? 'global' : msg.root
    this.busy(msg.root, true, '安装钩子')
    try {
      const result = await installHook({ extensionUri: this.extensionUri, scope })

      const lines = [`钩子已安装到 ${result.hooksPath}`]
      if (result.previousPaths.length > 0) {
        lines.push(`注意：原来的 core.hooksPath (${result.previousPaths.join(', ')}) 已被覆盖，原目录内容未删除`)
      }
      if (result.overwritten.length > 0) {
        lines.push(`原钩子已备份为 ${result.overwritten[0]}.bak`)

        // 覆盖用户已有的钩子是有损操作，必须显式确认过再往下走
        const keep = await vscode.window.showWarningMessage(
          `检测到已存在的 ${result.overwritten[0]}，已备份为 .bak。是否保留本次覆盖？`,
          { modal: false },
          '保留',
          '还原原钩子',
        )
        if (keep === '还原原钩子') {
          await uninstallHook(scope)
          this.notice('warn', '已撤销安装，core.hooksPath 恢复为未设置状态', msg.requestId, true)
          await this.refresh()
          return
        }
      }

      this.notice('info', lines.join('；'), msg.requestId, true)
      await this.refresh()
    } catch (err) {
      this.notice('error', `安装钩子失败：${describe(err)}`, msg.requestId, false)
    } finally {
      this.busy(msg.root, false)
    }
  }

  private async handleUninstallHook(root: string, requestId: string): Promise<void> {
    this.busy(root, true, '卸载钩子')
    try {
      const status = await readHookStatus(this.extensionUri, root)
      const scope = status.hooksPath === defaultHooksDir() ? 'global' : root
      await uninstallHook(scope)
      this.notice('info', '钩子已卸载，core.hooksPath 已清除', requestId, true)
      await this.refresh()
    } catch (err) {
      this.notice('error', `卸载钩子失败：${describe(err)}`, requestId, false)
    } finally {
      this.busy(root, false)
    }
  }

  private async openScm(root: string): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.view.scm')
    } catch {
      this.notice('warn', `无法打开源代码管理视图，仓库路径：${root}`)
    }
  }
}

function pickDefaultBase(bases: BaseBranch[], configured: string): string {
  if (configured) {
    const hit = bases.find((b) => b.name === configured || b.ref === configured)
    if (hit) return hit.ref
  }
  const preferred = ['master', 'main']
  for (const name of preferred) {
    const hit = bases.find((b) => b.name === name)
    if (hit) return hit.ref
  }
  return bases[0]?.ref ?? ''
}

/**
 * 推送远端推断：基线是 <remote>/<branch> 时优先推回同一个远端，
 * 否则用 origin，最后退化为第一个可用远端。
 */
function inferRemote(state: RepoState, base: string): string {
  if (base.includes('/')) {
    const remote = base.slice(0, base.indexOf('/'))
    if (remote && remote !== 'local') return remote
  }
  if (state.upstream?.includes('/')) {
    return state.upstream.slice(0, state.upstream.indexOf('/'))
  }
  return 'origin'
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
