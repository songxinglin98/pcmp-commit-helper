import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface GitResult {
  stdout: string
  stderr: string
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly cwd: string,
    readonly stderr: string,
  ) {
    super(message)
    this.name = 'GitError'
  }
}

/**
 * 执行 git 子命令。
 *
 * GIT_TERMINAL_PROMPT=0 是必须的：否则 push 需要凭据时 git 会在后台进程里
 * 挂起等待终端输入，表现为插件「卡住没有任何反应」。
 * 同理禁用编辑器与分页器，避免弹出交互界面。
 */
export async function git(cwd: string, args: string[], opts: { timeout?: number } = {}): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: opts.timeout ?? 120_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_EDITOR: 'true',
        GIT_PAGER: 'cat',
        LC_ALL: 'C',
      },
    })
    return { stdout, stderr }
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string; killed?: boolean }
    if (e.killed) {
      throw new GitError(`git ${args[0]} 超时未返回`, args, cwd, e.stderr ?? '')
    }
    const stderr = (e.stderr || e.stdout || e.message || '').trim()
    throw new GitError(stderr || `git ${args.join(' ')} 执行失败`, args, cwd, stderr)
  }
}

/** 分支名合法性：git check-ref-format 通过 + 无空格，挡住明显非法输入 */
export async function isValidBranchName(cwd: string, name: string): Promise<boolean> {
  if (!name || /\s/.test(name) || name.startsWith('-') || name.includes('..') || name.endsWith('/')) {
    return false
  }
  try {
    await git(cwd, ['check-ref-format', '--branch', name])
    return true
  } catch {
    return false
  }
}

export async function branchExists(cwd: string, name: string): Promise<boolean> {
  try {
    await git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])
    return true
  } catch {
    return false
  }
}

export interface RemoteBranchRef {
  name: string
  remote: string
  ref: string
  date: string
}

/**
 * 列出可作为基线的远端分支。
 *
 * 直接从 refs/remotes 读，不依赖仓库本地的分支命名习惯
 * （origin/dev、to_dev/dev、gerrit 的 to_master 都能拿到）。
 *
 * 分隔符必须是真实的制表符字面量：for-each-ref 不解析 %x09 这类转义，
 * 写 %x09 会被原样输出，把分支名污染成 "dev/PCMP-1%x092026-09-20T..."。
 */
export async function listRemoteBranches(cwd: string, limit = 200): Promise<RemoteBranchRef[]> {
  const { stdout } = await git(cwd, [
    'for-each-ref',
    '--sort=-committerdate',
    `--count=${limit}`,
    '--format=%(refname:short)\t%(committerdate:iso-strict)',
    'refs/remotes',
  ])

  const out: RemoteBranchRef[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const short = line.slice(0, tab)
    const date = line.slice(tab + 1)
    const slash = short.indexOf('/')
    if (slash <= 0) continue
    const remote = short.slice(0, slash)
    const name = short.slice(slash + 1)
    // <remote>/HEAD 是符号引用，不是真分支
    if (name === 'HEAD') continue
    out.push({ name, remote, ref: short, date })
  }
  return out
}
