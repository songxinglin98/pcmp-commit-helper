/**
 * PCMP 前缀规则。
 *
 * 规则（与需求确认一致）：
 *   - 分支名含关键字（默认 PCMP，忽略大小写）才加前缀，提交信息内容不参与判断
 *   - 前缀只取单号，形如 `PCMP-123`
 *   - 分支名含关键字但解析不出单号时，退化为原始分支名，保证前缀始终可用
 */

export interface PrefixResult {
  /** 是否命中 PCMP 关键字 */
  isPcmp: boolean
  /** 从分支名解析出的单号；无单号时为 null */
  ticket: string | null
  /** 最终要加到提交信息前面的字符串；空串表示不加前缀 */
  prefix: string
  /** 用于界面展示的说明 */
  reason: string
}

/**
 * 从分支名抽单号。
 *
 * 只认两种明确形态，其余一律返回 null（调用方退化为用完整分支名当前缀）：
 *   1. 关键字 + `-` 或 `_` + 数字：`dev/PCMP-123`、`feature/PCMP_456`
 *   2. 关键字直接接数字：`feature/PCMP123`
 *
 * 刻意不处理的形态：关键字后面是 `/` `.` 空格等其他字符，例如
 * `dev/PCMP.1+2-77`、`dev/PCMP(9)-8`。这些名字里关键字后的数字片段含义不明，
 * 猜错会把提交挂到错误的单号上，代价高于「不加前缀」。调用方退化为完整分支名，
 * 用户一眼能看出前缀不对，可以自行改分支名。
 *
 * 匹配走逐字符的 indexOf，不用正则：分支名里的 . ( ) [ ] 是正则元字符，
 * 用正则拼接会把它们当成模式解释。
 */
export function ticketFromBranch(branch: string, keyword = 'PCMP'): string | null {
  const kw = keyword.trim()
  if (!kw) return null

  const line = branch.toLowerCase()
  const k = kw.toLowerCase()
  const upper = kw.toUpperCase()

  // 形态 1：关键字 + - 或 _ + 数字
  let from = 0
  for (;;) {
    const at = line.indexOf(k, from)
    if (at === -1) break
    const sep = line[at + k.length]
    if (sep === '-' || sep === '_') {
      const digits = /^\d+/.exec(line.slice(at + k.length + 1))
      if (digits) return `${upper}-${digits[0]}`
    }
    from = at + 1
  }

  // 形态 2：关键字直接接数字
  from = 0
  for (;;) {
    const at = line.indexOf(k, from)
    if (at === -1) break
    const digits = /^\d+/.exec(line.slice(at + k.length))
    if (digits) return `${upper}-${digits[0]}`
    from = at + 1
  }

  return null
}

export function resolvePrefix(branch: string, keyword = 'PCMP'): PrefixResult {
  const kw = keyword.trim()
  if (!kw) {
    return { isPcmp: false, ticket: null, prefix: '', reason: '未配置关键字' }
  }

  if (!branch.toLowerCase().includes(kw.toLowerCase())) {
    return { isPcmp: false, ticket: null, prefix: '', reason: `分支名不含 ${kw}，忽略前缀` }
  }

  const ticket = ticketFromBranch(branch, kw)
  if (ticket) {
    return { isPcmp: true, ticket, prefix: `${ticket}: `, reason: `命中 ${ticket}` }
  }

  return {
    isPcmp: true,
    ticket: null,
    prefix: `${branch}: `,
    reason: `分支名含 ${kw} 但无单号，使用分支名作前缀`,
  }
}

/**
 * 把前缀合并到提交信息上。
 * 已有同前缀时不重复添加——amend / 反复提交的场景必须幂等。
 */
export function applyPrefix(summary: string, result: PrefixResult): string {
  const head = summary.trim()
  if (!result.prefix) return head
  const bare = result.prefix.slice(0, -2)
  if (head.startsWith(`${bare}:`) || head.startsWith(`${bare} `) || head === bare) {
    return head
  }
  return `${bare}: ${head}`
}
