import { context } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const watch = process.argv.includes('--watch')
const root = dirname(fileURLToPath(import.meta.url))

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  // 扩展宿主按 CommonJS 加载。根 package.json 是 "type": "module"（为了共享 webview
  // 的 ESM 源码），所以产物必须用 .cjs 扩展名，否则 VS Code 会把 CJS 产物当 ESM 加载而启动失败。
  outfile: 'dist/extension.cjs',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
  alias: {
    // 与 webview 共用同一份协议定义，避免字段名两边漂移
    '@shared': resolve(root, 'webview-ui/src'),
  },
}

const ctx = await context(options)

if (watch) {
  await ctx.watch()
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
