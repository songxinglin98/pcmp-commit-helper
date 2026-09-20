import type { BaseBranch, HostToWebview, RepoListPayload, RepoState, WebviewToHost } from '@shared/protocol'

declare global {
  interface Window {
    acquireVsCodeApi?: () => { postMessage(msg: unknown): void; getState<T>(): T; setState(s: unknown): void }
  }
}

type Listener = (msg: HostToWebview) => void

/**
 * 与扩展主机通信。
 *
 * acquireVsCodeApi 在扩展外（浏览器里跑 vite dev）不存在，
 * 此时降级为「丢掉发出消息 + 记日志」，让界面能独立开发和调试，
 * 不必每次改样式都去重启扩展宿主。
 */
class Bridge {
  private api = typeof window !== 'undefined' ? window.acquireVsCodeApi?.() : undefined
  private listeners = new Set<Listener>()

  post(msg: WebviewToHost): void {
    if (this.api) {
      this.api.postMessage(msg)
    } else if (import.meta.env.DEV) {
      console.info('[pcmp] 无扩展宿主，消息被忽略：', msg)
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 由 main.tsx 挂上 window 的 message 监听后调用 */
  dispatch(msg: HostToWebview): void {
    for (const listener of this.listeners) listener(msg)
  }
}

export const bridge = new Bridge()

export type { BaseBranch, RepoListPayload, RepoState, HostToWebview, WebviewToHost }
