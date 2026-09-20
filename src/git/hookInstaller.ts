import * as vscode from 'vscode'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { git } from './exec'

/** 安装位置：用户主目录下的隐藏目录，与任何仓库解耦 */
export const HOOKS_DIR_NAME = '.pcmp-git-hooks'
export const HOOK_FILE_NAME = 'prepare-commit-msg'

export interface HookStatus {
  /** core.hooksPath 当前指向，未设置为 null */
  hooksPath: string | null
  /** 是否已指向本插件的 hook 目录 */
  installed: boolean
  /** 该目录下的 hook 文件是否与插件内置版本一致 */
  upToDate: boolean
}

export function defaultHooksDir(): string {
  return join(homedir(), HOOKS_DIR_NAME)
}

/** 单仓库模式的目标目录：仓库根的 .githooks/，是 git 官方惯例位置 */
export function repoHooksDir(repoRoot: string): string {
  return join(repoRoot, '.githooks')
}

/** 读取插件自带的 hook 脚本内容，作为唯一可信来源 */
async function bundledHook(extensionUri: vscode.Uri): Promise<string> {
  const hookUri = vscode.Uri.joinPath(extensionUri, 'hooks', HOOK_FILE_NAME)
  const bytes = await vscode.workspace.fs.readFile(hookUri)
  return Buffer.from(bytes).toString('utf8')
}

export async function readHookStatus(extensionUri: vscode.Uri, repoRoot: string | null): Promise<HookStatus> {
  const [{ stdout }, bundled] = await Promise.all([
    git(process.cwd(), ['config', '--global', '--get', 'core.hooksPath']).catch(() => ({ stdout: '' })),
    bundledHook(extensionUri),
  ])
  const hooksPath = stdout.trim() || null

  if (!hooksPath) return { hooksPath: null, installed: false, upToDate: false }

  const globalDir = defaultHooksDir()
  const repoDir = repoRoot ? repoHooksDir(repoRoot) : null
  const matches = hooksPath === globalDir || (repoDir !== null && hooksPath === repoDir)
  if (!matches) return { hooksPath, installed: false, upToDate: false }

  try {
    const current = await readFile(join(hooksPath, HOOK_FILE_NAME), 'utf8')
    return { hooksPath, installed: true, upToDate: current === bundled }
  } catch {
    // 配置指向了插件目录，但文件不存在或读不到
    return { hooksPath, installed: true, upToDate: false }
  }
}

export interface InstallOptions {
  extensionUri: vscode.Uri
  /** global 对所有仓库生效；传仓库根路径则只对该仓库生效 */
  scope: 'global' | string
}

export interface InstallResult {
  hooksPath: string
  previousPaths: string[]
  overwritten: string[]
}

/**
 * 安装 hook。
 *
 * 两条安装路径：
 *   - 全局：写 core.hooksPath 指向插件目录，之后新建的仓库自动生效，零配置
 *   - 单仓库：写仓库级 core.hooksPath，不影响其他仓库
 *
 * 会把已存在的同名 hook 备份成 <name>.bak，不直接丢弃用户已有的钩子。
 */
export async function installHook(opts: InstallOptions): Promise<InstallResult> {
  const hookSource = await bundledHook(opts.extensionUri)
  const isGlobal = opts.scope === 'global'
  const targetDir = isGlobal ? defaultHooksDir() : repoHooksDir(opts.scope)
  const scopeFlag = isGlobal ? '--global' : '--local'
  const cwd = isGlobal ? process.cwd() : opts.scope

  const previousPaths: string[] = []
  const overwritten: string[] = []

  // 记录原有 core.hooksPath：如果用户本来就用别的目录管理 hook，
  // 直接覆盖会静默废掉他那套钩子，必须告知。
  try {
    const { stdout } = await git(cwd, ['config', scopeFlag, '--get', 'core.hooksPath'])
    const prev = stdout.trim()
    if (prev && prev !== targetDir) previousPaths.push(prev)
  } catch {
    // 未设置过，正常
  }

  await mkdir(targetDir, { recursive: true })

  const hookPath = join(targetDir, HOOK_FILE_NAME)
  try {
    const existing = await readFile(hookPath, 'utf8')
    if (existing !== hookSource) {
      await writeFile(`${hookPath}.bak`, existing, 'utf8')
      overwritten.push(hookPath)
    }
  } catch {
    // 文件不存在，无需备份
  }

  await writeFile(hookPath, hookSource, 'utf8')
  // git 要求 hook 可执行，否则会被静默忽略——这是最常见的「装了没生效」原因
  await chmod(hookPath, 0o755)

  await git(cwd, ['config', scopeFlag, 'core.hooksPath', targetDir])

  return { hooksPath: targetDir, previousPaths, overwritten }
}

/** 卸载：清掉本插件写的 core.hooksPath 配置 */
export async function uninstallHook(scope: 'global' | string): Promise<void> {
  const scopeFlag = scope === 'global' ? '--global' : '--local'
  const cwd = scope === 'global' ? process.cwd() : scope
  try {
    await git(cwd, ['config', scopeFlag, '--unset', 'core.hooksPath'])
  } catch {
    // 本就没设置，无需处理
  }
}
