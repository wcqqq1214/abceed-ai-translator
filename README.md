# abceed AI 翻译

自动将 [abceed](https://app.abceed.com/) 网页中的日文替换为中文，**英语保持原样**。支持 OpenAI 兼容接口、本地译文缓存，使用 DeepSeek 官方接口时自动关闭思考模式。

## 使用

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)，再 **[安装脚本](https://raw.githubusercontent.com/wcqqq1214/abceed-ai-translator/main/dist/abceed-ai-translator.user.js)**。
2. 打开 abceed，点击右下角「AI 翻译」，填写 HTTPS API 地址、模型和 Key，点击「保存并开启」。
3. 关闭其他整页翻译；勾选「记住密钥」可在下次打开时自动运行。

双击英文单词可查看 AI 中文释义，保留原文。

译文本地缓存不自动过期，容量满时淘汰旧条目，也可手动清除。新内容会发送给配置的 AI 服务商，可能产生费用。不支持图片内文字。脚本未运行时，请检查 [用户脚本执行权限](https://www.tampermonkey.net/faq.php?locale=zh&q=Q209)。

[MIT](LICENSE) · 非 abceed 官方项目。
