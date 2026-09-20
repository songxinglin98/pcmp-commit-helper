import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// VS Code webview 里加载的是 vscode-webview:// 协议，不是 http(s)。
// 两点约束直接决定了下面的配置：
//  1. base './' —— 绝对路径 /assets/xxx 在这个协议下解析不到
//  2. 单文件产物 —— 动态 import 和独立 css 文件同样会走协议解析，容易失败，
//     因此内联动态导入、禁用 css 代码分割，让所有 js/css 收进一个 index.js
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      // 协议定义与扩展侧共用同一份文件，tsconfig.paths 里也配了同样的映射
      '@shared': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
    modulePreload: false,
    sourcemap: true,
    // 产物直接落到 assets/index.js：扩展侧拼 URI 时不必猜测带 hash 的文件名
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    cors: true,
  },
})
