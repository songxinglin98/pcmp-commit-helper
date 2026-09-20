import { git, isValidBranchName, branchExists } from './exec'

export interface CreateBranchOptions {
  root: string
  /** 新分支名，例如 dev/PCMP-123 */
  name: string
  /** 基线分支完整引用，例如 origin/master；留空表示以当前 HEAD 为基线 */
  base: string
  /** 推送目标远端，例如 origin */
  pushRemote: string
}

export interface CreateBranchResult {
  branch: string
  base: string
  pushed: boolean
}

/**
 * 创建分支并推送。
 *
 * 用 `git switch -c <name> <base>` 直接以基线建分支并切过去；
 * 推送同样带 --set-upstream，避免用户再手动 push -u 一次。
 */
export async function createAndPushBranch(opts: CreateBranchOptions): Promise<CreateBranchResult> {
  const { root, name, base, pushRemote } = opts

  if (!(await isValidBranchName(root, name))) {
    throw new Error(`分支名 "${name}" 不是合法的 git 分支名`)
  }
  if (await branchExists(root, name)) {
    throw new Error(`本地已存在分支 "${name}"，请换一个名字`)
  }

  await git(root, base ? ['switch', '-c', name, base] : ['switch', '-c', name])

  try {
    await git(root, ['push', '--set-upstream', pushRemote, name], { timeout: 180_000 })
    return { branch: name, base, pushed: true }
  } catch (err) {
    // 分支已在本地建好并切过去了，推送失败不否认这一点，让用户能直接重试 push
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`分支 "${name}" 已创建并切换，但推送到 ${pushRemote} 失败：${detail}`)
  }
}

export interface CommitOptions {
  root: string
  /** 已经带好前缀的首行 */
  summary: string
  description: string
  amend: boolean
}

/**
 * 提交。
 *
 * 前缀在这里由调用方拼好，本函数只负责落盘；
 * 多行信息用多次 -m，git 会把它们按空行分段，天然区分标题与正文。
 */
export async function commit(opts: CommitOptions): Promise<void> {
  const { root, summary, description, amend } = opts
  const trimmed = summary.trim()
  if (!trimmed) throw new Error('提交信息不能为空')

  const args = ['commit']
  if (amend) args.push('--amend')
  args.push('-m', trimmed)

  const body = description.trim()
  if (body) args.push('-m', body)

  const { stdout } = await git(root, args)
  return void stdout
}
