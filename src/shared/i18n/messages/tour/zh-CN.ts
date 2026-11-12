import type { TourMessages } from './types'

export const tourZhCN: TourMessages = {
  step: {
    open: '打开您电脑上已有的仓库。',
    clone: '把远程仓库复制到本地文件夹。',
    branch: '显示当前分支，新的提交会加到这里。',
    fetch: '从远程获取有变化的内容，不改动您的文件。',
    pull: '拉取远程的更改，并整合到当前分支。',
    push: '把您的提交推送到远程。',
    new: '创建分支或标签，或暂存您的更改。',
    studio: '打开拣选工作台，把提交复制到当前分支。',
    conflicts: '显示冲突或正在进行的操作；打开冲突界面。',
    settings: '齿轮按钮打开设置（共 8 个部分）；在“外观”中可设置工具栏、屏幕和面板。',
    screens: '屏幕标签：历史、更改、文件、比较、分支、Git 日志和仪表盘。',
    history: '提交列表；点击其中一个查看详情。',
    'history-diff': '所选提交的差异，逐个文件显示。',
    'changes-commit': '编写提交信息，并提交已暂存的内容。',
    'changes-diff': '提交前查看所选文件的更改。',
    files: '已跟踪的文件；打开一个可查看其历史和内容。',
    compare: '选择两个引用（分支、标签或提交）进行比较。',
    branches: '分支、标签和 stash：切换分支并查看现有内容。',
    gitlog: 'GitTools 执行过的 git 命令，每条都可以复制。',
    dashboards: '仓库的图表和数字；导览只显示标签，不打开该屏幕。'
  },
  card: {
    previous: '上一步',
    next: '下一步',
    exit: '退出',
    finish: '完成',
    progress: '{current} / {total}',
    skippedTitle: '已跳过的步骤：',
    noRepoEnd: '打开仓库后，导览的其余部分会出现。',
    hiddenTitle: '隐藏的屏幕，无对应步骤：',
    title: '界面导览'
  }
}
