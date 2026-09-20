import { basename } from 'node:path'
import { git } from './exec'
import { resolvePrefix } from '@shared/pcmpPrefix'
import type { RepoState } from '@shared/protocol'

/**
 * 判断目录是否在 git 仓库内，是则返回仓库根目录。
 * 用 rev-parse 而不是查找 .git —— 兼容 worktree 和 submodule。
 */
export async function findRepoRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await git(cwd, ['rev-parse', '--show-toplevel'])
    const root = stdout.trim()
    return root || null
  } catch {
    return null
  }
}

export async function readRepoState(root: string, keyword: string): Promise<RepoState> {
  const branch = await readBranch(root)
  const { staged, unstaged, untracked } = await readStatus(root)
  const { upstream, ahead, behind } = await readUpstream(root)

  const prefix = resolvePrefix(branch.name, keyword)
  return {
    root,
    name: basename(root),
    branch: branch.name,
    detached: branch.detached,
    isPcmp: prefix.isPcmp,
    ticket: prefix.ticket,
    staged,
    unstaged,
    untracked,
    upstream,
    ahead,
    behind,
  }
}

async function readBranch(root: string): Promise<{ name: string; detached: boolean }> {
  try {
    const { stdout } = await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])
    const name = stdout.trim()
    if (name) return { name, detached: false }
  } catch {
    // detached HEAD 时 symbolic-ref 会失败，回落到短 hash
  }
  try {
    const { stdout } = await git(root, ['rev-parse', '--short', 'HEAD'])
    return { name: stdout.trim() || '(空仓库)', detached: true }
  } catch {
    return { name: '(无提交)', detached: true }
  }
}

interface StatusCounts {
  staged: number
  unstaged: number
  untracked: number
}

/**
 * 统计暂存/未暂存/未跟踪。
 * 用 -z 而不是换行分隔：文件路径里可能含换行或引号，-z 是唯一可靠的切分方式。
 */
async function readStatus(root: string): Promise<StatusCounts> {
  const counts: StatusCounts = { staged: 0, unstaged: 0, untracked: 0 }
  try {
    const { stdout } = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    for (const entry of stdout.split('\0')) {
      if (entry.length < 3) continue
      const x = entry[0]
      const y = entry[1]
      if (x === '?' && y === '?') {
        counts.untracked += 1
        continue
      }
      if (x !== ' ' && x !== '?') counts.staged += 1
      if (y !== ' ' && y !== '?') counts.unstaged += 1
    }
  } catch {
    // 状态读不到不应阻断整个面板，返回全 0
  }
  return counts
}

interface UpstreamInfo {
  upstream: string | null
  ahead: number
  behind: number
}

async function readUpstream(root: string): Promise<UpstreamInfo> {
  try {
    const { stdout } = await git(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
    const [behindRaw, aheadRaw] = stdout.trim().split(/\s+/)
    const { stdout: up } = await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
    return {
      upstream: up.trim() || null,
      ahead: Number.parseInt(aheadRaw ?? '0', 10) || 0,
      behind: Number.parseInt(behindRaw ?? '0', 10) || 0,
    }
  } catch {
    return { upstream: null, ahead: 0, behind: 0 }
  }
}
