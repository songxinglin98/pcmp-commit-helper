import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'

export interface WebviewAssets {
  scriptUri: vscode.Uri
  /** Vite 在 cssCodeSplit:false 下产出的单一样式表；产物不存在时为 null */
  styleUri: vscode.Uri | null
  localResourceRoots: vscode.Uri[]
}

/**
 * 定位 Vite 构建产物。
 *
 * 扩展自身的 dist/extension.js 与 webview 的 dist/webview 分开存放，
 * localResourceRoots 收紧到 webview 目录，避免 webview 能引用扩展其他文件。
 */
export async function resolveAssets(extensionUri: vscode.Uri): Promise<WebviewAssets> {
  const webviewRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
  const assetsRoot = vscode.Uri.joinPath(webviewRoot, 'assets')
  const scriptUri = vscode.Uri.joinPath(assetsRoot, 'index.js')

  const styleCandidate = vscode.Uri.joinPath(assetsRoot, 'style.css')
  let styleUri: vscode.Uri | null = null
  try {
    await vscode.workspace.fs.stat(styleCandidate)
    styleUri = styleCandidate
  } catch {
    // 无样式产物（例如全新克隆还没跑 build）时不影响脚本加载
  }

  return { scriptUri, styleUri, localResourceRoots: [webviewRoot] }
}

/**
 * 生成 webview HTML。
 *
 * CSP 里只有开发模式才放开 Vite dev server 的来源，生产构建是纯静态本地资源，
 * 不需要任何网络来源。
 */
export function buildHtml(
  webview: vscode.Webview,
  assets: WebviewAssets,
  opts: { devServer?: string } = {},
): string {
  const nonce = randomBytes(16).toString('base64')
  const scriptUri = webview.asWebviewUri(assets.scriptUri)
  const styleTag = assets.styleUri
    ? `<link rel="stylesheet" href="${webview.asWebviewUri(assets.styleUri)}" />`
    : ''

  const devServer = opts.devServer?.replace(/\/$/, '')
  const extraSrc = devServer ? ` http://${hostOf(devServer)} ws://${hostOf(devServer)}` : ''
  const devTags = devServer ? `<script type="module" src="${devServer}/@vite/client"></script>` : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'${extraSrc}; font-src ${webview.cspSource};" />
<title>PCMP Commit Helper</title>
${styleTag}
</head>
<body>
<div id="root"></div>
${devTags}
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'localhost:5173'
  }
}
