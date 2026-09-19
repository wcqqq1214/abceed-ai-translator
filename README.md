<h1 align="center">abceed AI 翻译</h1>

<p align="center">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&amp;logo=javascript&amp;logoColor=222222" alt="JavaScript">
  <a href="https://www.tampermonkey.net/"><img src="https://img.shields.io/badge/Tampermonkey-00485B?style=flat&amp;logo=tampermonkey&amp;logoColor=white" alt="Tampermonkey"></a>
  <img src="https://img.shields.io/badge/API-OpenAI%20Compatible-10A37F?style=flat" alt="OpenAI 兼容接口">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-64748B?style=flat" alt="MIT 许可证"></a>
</p>

<p align="center">为 abceed 提供 AI 日文翻译、英文查词与发音、听力快捷键。</p>

## 使用

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)，再 **[安装脚本](https://raw.githubusercontent.com/wcqqq1214/abceed-ai-translator/main/dist/abceed-ai-translator.user.js)**。
2. 打开 [abceed](https://app.abceed.com/)，在右下角「AI 翻译 → 接口设置」填写 HTTPS API 地址、模型和 Key，点击「保存并开启」。
3. 关闭其他整页翻译；可勾选「记住密钥」以便下次自动运行。

自动翻译日文，英语原文保持不变。双击英文查释义，划选短语或句子自动翻译；点击弹窗喇叭朗读英文，再点停止。翻译使用 AI，发音使用系统语音。DeepSeek 官方接口自动关闭思考模式。

听力播放器：<kbd>←</kbd> 后退 3 秒，<kbd>→</kbd> 前进 3 秒，<kbd>空格</kbd> 播放／暂停。输入和编辑时不触发。

译文本地缓存不自动过期，容量满时淘汰旧条目。菜单支持清除缓存、检查更新和重试失败内容。新内容会发送给配置的 AI 服务商，可能产生费用。

不支持图片文字，已列入 [TODO](TODO.md)。脚本未运行时，检查 [用户脚本执行权限](https://www.tampermonkey.net/faq.php?locale=zh&q=Q209)。

非 abceed 官方项目。
