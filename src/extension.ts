import * as vscode from 'vscode'
import { PcmpViewProvider } from './viewProvider'
import { buildHtml, resolveAssets } from './webview/html'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const assets = await resolveAssets(context.extensionUri)
  const devServer = process.env.PCMP_WEBVIEW_DEV_SERVER

  const renderHtml = (webview: vscode.Webview) => {
    webview.options = {
      enableScripts: true,
      localResourceRoots: assets.localResourceRoots,
    }
    return buildHtml(webview, assets, { devServer })
  }

  const provider = new PcmpViewProvider(context.extensionUri, renderHtml)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PcmpViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  // 分支切换、提交、文件改动都会改变面板内容。
  // 监听 .git/HEAD 能精确捕捉分支切换，比轮询 git 便宜得多；
  // 节流是因为一次 checkout 会连带来一串文件事件。
  let timer: NodeJS.Timeout | undefined
  const scheduleRefresh = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void provider.refresh(), 400)
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(scheduleRefresh),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) scheduleRefresh()
    }),
  )

  const headWatcher = vscode.workspace.createFileSystemWatcher('**/.git/HEAD')
  context.subscriptions.push(
    headWatcher,
    headWatcher.onDidChange(scheduleRefresh),
    headWatcher.onDidCreate(scheduleRefresh),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('pcmpCommitHelper.focus', () =>
      vscode.commands.executeCommand(`${PcmpViewProvider.viewId}.focus`),
    ),
    vscode.commands.registerCommand('pcmpCommitHelper.refresh', () => provider.refresh()),
  )
}

export function deactivate(): void {
  // 所有 disposable 已注册进 context.subscriptions，无需手动清理
}
