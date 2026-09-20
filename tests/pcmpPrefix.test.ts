import { describe, expect, it } from 'vitest'
import { applyPrefix, resolvePrefix, ticketFromBranch } from '../webview-ui/src/pcmpPrefix.ts'

describe('ticketFromBranch', () => {
  it('从常见分支名里抽出单号', () => {
    expect(ticketFromBranch('PCMP-123')).toBe('PCMP-123')
    expect(ticketFromBranch('dev/PCMP-123')).toBe('PCMP-123')
    expect(ticketFromBranch('feature/PCMP-123-login')).toBe('PCMP-123')
    expect(ticketFromBranch('pcmp-456')).toBe('PCMP-456')
    expect(ticketFromBranch('feature/PCMP_789')).toBe('PCMP-789')
    expect(ticketFromBranch('feature/PCMP123')).toBe('PCMP-123')
  })

  it('关键字后是歧义字符时返回 null，交给调用方退化为分支名', () => {
    // 这些名字里关键字后的数字片段含义不明，猜错会把提交挂到错误单号上，
    // 因此刻意不解析，由 resolvePrefix 退化为完整分支名前缀。
    expect(ticketFromBranch('dev/PCMP.1+2-77')).toBeNull()
    expect(ticketFromBranch('dev/PCMP(9)-8')).toBeNull()
    expect(ticketFromBranch('feature/PCMP login')).toBeNull()
  })

  it('没有单号时返回 null', () => {
    expect(ticketFromBranch('dev')).toBeNull()
    expect(ticketFromBranch('feature/PCMP-login')).toBeNull()
    expect(ticketFromBranch('PCMP-abc')).toBeNull()
  })

  it('分支名含正则元字符不被当成模式', () => {
    // 关键字后跟可识别形态时，后面的元字符不应影响解析
    expect(ticketFromBranch('dev/PCMP-8(2)')).toBe('PCMP-8')
    expect(ticketFromBranch('dev/PCMP-5[1]')).toBe('PCMP-5')
    expect(ticketFromBranch('dev/PCMP+7')).toBeNull()
  })

  it('关键字可配置', () => {
    expect(ticketFromBranch('feature/JIRA-42', 'JIRA')).toBe('JIRA-42')
    expect(ticketFromBranch('feature/JIRA-42', 'PCMP')).toBeNull()
  })
})

describe('resolvePrefix', () => {
  it('分支不含关键字时不加前缀', () => {
    const r = resolvePrefix('dev')
    expect(r.isPcmp).toBe(false)
    expect(r.prefix).toBe('')
  })

  it('分支含关键字且有单号时用单号作前缀', () => {
    const r = resolvePrefix('dev/PCMP-123')
    expect(r.isPcmp).toBe(true)
    expect(r.prefix).toBe('PCMP-123: ')
  })

  it('分支含关键字但没有单号时退化为分支名', () => {
    const r = resolvePrefix('feature/PCMP-login')
    expect(r.isPcmp).toBe(true)
    expect(r.prefix).toBe('feature/PCMP-login: ')
  })

  it('大小写不敏感', () => {
    expect(resolvePrefix('dev/pcmp-9').prefix).toBe('PCMP-9: ')
  })
})

describe('applyPrefix', () => {
  it('把前缀拼在提交信息前', () => {
    expect(applyPrefix('修复登录', resolvePrefix('dev/PCMP-123'))).toBe('PCMP-123: 修复登录')
  })

  it('已有同样前缀时不重复添加', () => {
    const p = resolvePrefix('dev/PCMP-123')
    expect(applyPrefix('PCMP-123: 修复登录', p)).toBe('PCMP-123: 修复登录')
    expect(applyPrefix('PCMP-123 修复登录', p)).toBe('PCMP-123 修复登录')
    expect(applyPrefix('PCMP-123', p)).toBe('PCMP-123')
  })

  it('不含关键字的开发者手写的其他前缀不受影响', () => {
    const p = resolvePrefix('dev')
    expect(applyPrefix('[hotfix] 紧急修复', p)).toBe('[hotfix] 紧急修复')
  })

  it('去掉首尾空白', () => {
    expect(applyPrefix('  修复登录  ', resolvePrefix('dev/PCMP-1'))).toBe('PCMP-1: 修复登录')
  })
})
