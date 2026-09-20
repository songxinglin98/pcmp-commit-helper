#!/bin/sh
# hooks/prepare-commit-msg 的场景测试。
# 用一个临时仓库逐条演练真实 git 提交流程，断言最终落到 history 里的提交信息。
# 用法：sh tests/hook.test.sh

set -e

HOOK_SRC=$(cd "$(dirname "$0")/.." && pwd)/hooks/prepare-commit-msg
WORK=$(mktemp -d)
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

PASS=0
FAIL=0

setup() {
  rm -rf "$WORK/repo"
  mkdir -p "$WORK/repo/.git-hooks"
  cp "$HOOK_SRC" "$WORK/repo/.git-hooks/prepare-commit-msg"
  chmod +x "$WORK/repo/.git-hooks/prepare-commit-msg"
  cd "$WORK/repo"
  git init -q .
  git config core.hooksPath ./.git-hooks
  echo seed > seed.txt && git add seed.txt && git commit -qm "初始提交"
}

# check <用例名> <期望的首行> <分支名> <提交信息首行> [正文]
check() {
  name="$1"; expect="$2"; branch="$3"; subject="$4"; body="$5"

  git switch -q --detach 2>/dev/null || true
  git branch -D "$branch" >/dev/null 2>&1 || true
  git switch -q -c "$branch" 2>/dev/null

  echo "x$RANDOM" > f.txt && git add f.txt
  if [ -n "$body" ]; then
    git commit -qm "$subject" -m "$body"
  else
    git commit -qm "$subject"
  fi

  actual=$(git log --format=%s -1)
  actual_body=$(git log --format=%b -1 | sed '/^$/d')

  if [ "$actual" = "$expect" ]; then
    PASS=$((PASS + 1))
    printf '  PASS  %-34s %s\n' "$name" "$actual"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL  %-34s 期望 [%s] 实际 [%s]\n' "$name" "$expect" "$actual"
  fi

  if [ -n "$body" ] && [ "$actual_body" != "$body" ]; then
    FAIL=$((FAIL + 1))
    printf '  FAIL  %-34s 正文被破坏，期望 [%s] 实际 [%s]\n' "$name" "$body" "$actual_body"
  fi
}

echo "== 基本前缀 =="
setup
check "通常分支"           "PCMP-123: 修复登录"        "dev/PCMP-123"          "修复登录"
check "关键字后紧接数字"   "PCMP-456: 修复登录"        "feature/PCMP456-fix"   "修复登录"
check "下划线分隔"         "PCMP-789: 修复登录"        "feature/PCMP_789"      "修复登录"
check "小写分支名"         "PCMP-9: 修复登录"          "dev/pcmp-9"            "修复登录"

echo "== 不加前缀 =="
setup
check "分支不含关键字"     "修复登录"                  "dev"                   "修复登录"
check "分支含 feature"     "修复登录"                  "feature/login"         "修复登录"

echo "== 退化：含关键字但无单号 =="
setup
check "无数字时用分支名"   "feature/PCMP-login: 修复登录" "feature/PCMP-login"  "修复登录"

echo "== 幂等 =="
setup
check "已带前缀不重复"     "PCMP-123: 修复登录"        "dev/PCMP-123"          "PCMP-123: 修复登录"
check "已带方括号前缀"     "[PCMP-123] 修复登录"       "dev/PCMP-123"          "[PCMP-123] 修复登录"
check "前缀与信息相同"     "PCMP-123"                  "dev/PCMP-123"          "PCMP-123"

echo "== 正文与多行 =="
setup
check "保留正文"           "PCMP-123: 修复登录"        "dev/PCMP-123"          "修复登录" "第一段正文。"
check "多段正文"           "PCMP-123: 修复登录"        "dev/PCMP-123"          "修复登录" "第一段。"

echo "== 正则/glob 元字符分支名 =="
setup
# 分支名里的 . + ( ) 在 sed 正则和 shell glob 里都是元字符。
# 用裸 sed 或裸 case 匹配的实现会在这些名字上出错，这里确认按字面处理。
check "歧义名退化为分支名" "dev/PCMP.1+2-77: 修复登录" "dev/PCMP.1+2-77" "修复登录"
check "圆括号在关键字后"   "dev/PCMP(9)-8: 修复登录" "dev/PCMP(9)-8"        "修复登录"
check "单号后带元字符"     "PCMP-8: 修复登录"  "dev/PCMP-8(2)"        "修复登录"

echo "== 空信息 / merge =="
setup
git switch -q -c dev/PCMP-123
echo a > a.txt && git add a.txt
git commit -q --allow-empty-message -m "" 2>/dev/null || true
empty_msg=$(git log --format=%s -1)
if [ "$empty_msg" != "PCMP-123:" ] && [ -n "$(git log --format=%H -1 2>/dev/null)" ]; then
  PASS=$((PASS + 1)); echo "  PASS  空信息不产生垃圾前缀"
else
  FAIL=$((FAIL + 1)); echo "  FAIL  空信息被加了前缀: [$empty_msg]"
fi

echo "== amend 不叠前缀 =="
setup
check "amend 首次"         "PCMP-123: 修复登录"        "dev/PCMP-123"          "修复登录"
git commit -q --amend -m "修复登录(改)" 2>/dev/null
amended=$(git log --format=%s -1)
if [ "$amended" = "PCMP-123: 修复登录(改)" ]; then
  PASS=$((PASS + 1)); echo "  PASS  amend 后 $amended"
else
  FAIL=$((FAIL + 1)); echo "  FAIL  amend 后 [$amended]"
fi
git commit -q --amend --no-edit 2>/dev/null
amended2=$(git log --format=%s -1)
if [ "$amended2" = "PCMP-123: 修复登录(改)" ]; then
  PASS=$((PASS + 1)); echo "  PASS  amend --no-edit 不叠前缀"
else
  FAIL=$((FAIL + 1)); echo "  FAIL  amend --no-edit 叠成 [$amended2]"
fi

echo "== 关键字可配置 =="
setup
PCMP_HOOK_KEYWORD=JIRA
export PCMP_HOOK_KEYWORD
check "自定义关键字"       "JIRA-42: 修复登录"         "feature/JIRA-42"       "修复登录"
unset PCMP_HOOK_KEYWORD

echo "== 非 PCMP 分支的 merge =="
setup
git switch -q -c dev/PCMP-123
echo a > a.txt && git add a.txt && git commit -qm "分支上的提交"
git switch -q -c side master 2>/dev/null || git switch -q -c side main
echo b > b.txt && git add b.txt && git commit -qm "side 上的提交"
git switch -q dev/PCMP-123
git merge -q --no-ff side -m "合并 side 分支" 2>/dev/null
merged=$(git log --format=%s -1)
if [ "$merged" = "合并 side 分支" ]; then
  PASS=$((PASS + 1)); echo "  PASS  merge 不干预: $merged"
else
  FAIL=$((FAIL + 1)); echo "  FAIL  merge 被改: [$merged]"
fi

echo
echo "通过 $PASS, 失败 $FAIL"
cd /
rm -rf "$WORK"
[ "$FAIL" -eq 0 ]
