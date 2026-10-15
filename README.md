# 力扣题单批量管理器

为 **力扣中国站** `leetcode.cn/problem-list/*` 增加复选框和批量操作工具栏的用户脚本。

A Tampermonkey userscript for selecting and managing multiple problems in LeetCode CN problem lists. It targets `leetcode.cn`, not `leetcode.com`.

## 功能

- 多选题目，滚动虚拟列表后保留已有选择。
- 批量添加到自建题单。
- 从当前题单批量移除。
- 批量移到题单顶部。
- 适配站内导航、深色主题和窄屏布局。

## 安装

1. 安装 Tampermonkey 等用户脚本管理器。
2. 打开 [`leetcode-multichoice.js`](leetcode-multichoice.js)，点击 **Raw**，通过脚本管理器安装；也可将完整脚本复制到管理器的新脚本编辑器。
3. 登录力扣中国站，打开你有权限管理的题单。
4. 使用页面中的复选框和批量工具栏。

脚本元数据已配置 Greasy Fork 的下载与更新地址，安装后的更新来源以用户脚本管理器显示为准。

## 使用范围

“选择可见”只涵盖当前已渲染的题目，不能据此认定整份长题单已经全部选中。执行移除或置顶前，请核对所选题目。

脚本通过力扣同源 `/graphql/` 接口操作题单，并复用当前浏览器登录态及所需的会话/CSRF 字段。它不提供独立账号登录功能；页面结构或接口变化后可能需要更新。

## English overview

Install the script through a userscript manager, sign in to LeetCode CN, and open a problem list you can edit. Select rendered problems and use the batch toolbar to add, remove, or move them to the top. Selection survives virtual-list scrolling, but selecting visible rows does not select every problem in a long list. Requests use LeetCode's same-origin GraphQL API and the current browser session.
