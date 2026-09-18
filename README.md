# abceed AI 日文自动翻译

Chrome / Tampermonkey 用户脚本：用 AI 将 abceed 网页中的日文自动替换为简体中文，**英语保持原样**。无需选中文字，不显示日文对照，不使用传统机翻接口。

## 安装使用

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)，再点击 **[安装脚本](https://raw.githubusercontent.com/wcqqq1214/abceed-ai-translator/main/dist/abceed-ai-translator.user.js)**。
2. 打开 [abceed 网页版](https://app.abceed.com/)，关闭 Chrome 和其他扩展的整页翻译。
3. 点击右下角“中 · AI 设置”，填写以下信息，点击“保存并自动翻译”。

| 配置 | 说明 |
| --- | --- |
| API 地址 | OpenAI 兼容 Chat Completions 接口的 HTTPS Base URL，例如 `https://openrouter.ai/api/v1`；也支持完整的 `/chat/completions` 地址。 |
| 模型 ID | 服务商提供的模型名称，需支持按指令输出 JSON。 |
| API Key | 对应服务商的 Key。勾选“记住 Key”后保存在 Tampermonkey 中，下次打开自动运行。 |

若脚本未运行，按 [Tampermonkey 说明](https://www.tampermonkey.net/faq.php#Q209) 允许用户脚本执行；首次请求时允许访问你配置的 API 域名。安装链接只显示源码时，可在 Tampermonkey 中新建脚本并粘贴完整源码。

## 注意事项

- 可见日文及混合段落中的英语上下文会发送给所填 AI 服务商，可能产生 API 费用；纯英文、隐藏答案和输入框不处理。
- 滚动或出现新解析后自动翻译，不支持图片内文字。接口报错会暂停；本标签页累计发送 50,000 字符后暂停，刷新可继续。
- 使用 DeepSeek 官方接口时自动关闭思考模式，优先翻译速度。
- 译文在 Tampermonkey 本地缓存 30 天，最多 1,000 条；刷新、重开主页直接复用，无需等待 AI。新内容仍需首次翻译，更换接口或模型后缓存不混用。面板显示缓存命中数，可用“清除缓存”删除。
- 勾选“记住 Key”可在重开页面后自动运行。“清除 Key”只删除 Key；卸载脚本后刷新页面可恢复原貌。

## 开发

使用 Node.js 26+（其他兼容版本见 `package.json`）。

```sh
npm ci
npm run check   # 测试与构建
npm run demo    # 本地模拟演示，不调用真实 AI
```

构建产物：`dist/abceed-ai-translator.user.js`。真实接口及翻译效果需配置自己的 Key 验证。

[MIT License](LICENSE) · 非 abceed 官方项目。
