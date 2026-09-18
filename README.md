# abceed AI 日文自动翻译

Chrome / Tampermonkey 用户脚本：把 [abceed 网页版](https://app.abceed.com/) 中**可见的日文直接替换成简体中文**，英语练习内容原样保留。无需选中文字、点选段落，也不显示日中双语全文。

只调用用户配置的大语言模型（OpenAI 兼容 Chat Completions 接口）。**没有 Google、百度、DeepL 等传统翻译接口，也没有机翻回退。**脚本无法验证任意第三方接口的真实后端，请自行选择可信的大模型服务商。

## 安装

1. 在 Chrome 中从 [Tampermonkey 官方网站](https://www.tampermonkey.net/) 进入 Chrome Web Store 安装 Tampermonkey。
2. 如果 Chrome / Tampermonkey 提示用户脚本未获准运行，按其提示开启“允许用户脚本”；旧版本可能需要扩展页面的开发者模式。参见 [Tampermonkey 官方说明](https://www.tampermonkey.net/faq.php#Q209)。
3. 点击 **[安装 abceed AI 翻译脚本](https://raw.githubusercontent.com/wcqqq1214/abceed-ai-translator/main/dist/abceed-ai-translator.user.js)**，在 Tampermonkey 安装页面确认。如果浏览器只显示源码，在 Tampermonkey 中“添加新脚本”，用完整源码替换默认模板并保存。
4. 打开或刷新 [app.abceed.com](https://app.abceed.com/)。点击右下角“中 · AI 设置”，填写 API 地址、模型 ID、API Key，点击“保存并自动翻译”。
5. 首次跨域请求时，Tampermonkey 可能要求允许访问所填 API 域名；确认域名与你选择的服务商一致。

**请关闭 Chrome 自带的日文整页翻译及其他翻译扩展在 abceed 上的自动翻译**，让本脚本读到原始日文。无需更改 abceed 的英语内容。

## 配置

| 字段 | 填法 |
| --- | --- |
| API 地址 | 服务商的 HTTPS Base URL，例如 `https://your-provider.example/v1`；会追加 `/chat/completions`。也支持完整接口地址。 |
| 模型 ID | 填服务商提供的准确模型名称；需支持 system/user messages、非流式文本输出和 JSON 指令。 |
| API Key | 该服务商的 Key。只发送给配置的地址。 |
| 记住 Key | 可选，保存在 Tampermonkey 脚本存储中。默认不勾选，刷新后需重填。 |

例如 OpenRouter 的地址可填 `https://openrouter.ai/api/v1`，模型名称从服务商账户的可用模型列表选择。其他兼容服务商同理。此版本不支持仅有 Responses API / Anthropic Messages 原生接口的服务，也不接受明文 HTTP 地址。

勾选“记住 Key”并保存后，下次打开 abceed 会自动开始。暂停状态会保存；点击“保存并自动翻译”恢复。更换模型后，已经替换的中文不会即时重译，刷新网页即可从日文重新开始。

## 工作方式

- 自动识别页面可见文字中的假名、汉字，批量翻译日文菜单、说明和解析。纯汉字标签按 abceed 的日语环境处理；这不是通用中日语言检测器。
- 纯英文文字不进入请求。混合文字中的拉丁字母、数字及相邻英文标点先替换成占位符，供模型理解的英语映射会随该段日文一起发送；写回时恢复原字符。模型漏掉、重复或打乱占位符时，整批停止替换。
- 译文直接写入原文字节点，保留按钮、段落及事件绑定。不新增日文对照，不改变纯英文题目。
- 当前视口外、隐藏的答案、输入框、可编辑区域、代码和 `translate="no"` 区域不处理。滚动、出现解析或页面更新后再处理新可见日文。
- 不自动点击答案或提交题目。不读取应用内部数据、接口、账号密码、Cookie 或未展示的教材。
- 每批最多 12 段，通常不超过 7,000 字符；单段最多 16,000 字符。本标签页累计发送 50,000 个原文字符后暂停，刷新可重新开始。
- 请求串行发送，批次间至少约 750ms；超时 60 秒。错误后暂停，不自动重试、不切换服务商或翻译引擎。
- 最多缓存 500 条成功译文，仅存在当前标签页内存，刷新即清空。缓存用于去重和重新挂载内容，不显示原文全文。

日文在 AI 返回之前暂时保持原状；只有验证通过才替换。图片、PDF、视频字幕画面、Canvas 内的日文不支持；HTML 文字字幕可以处理，但快速变化的字幕未必来得及翻译。过长文本会跳过并在面板提示。abceed 改版或浏览器翻译干预可能影响效果。

## 数据与权限

- 保存并开启后，可见的候选日文及混合段落中的英语上下文会自动发给**你填的 AI 服务商**，可能产生 API 费用。不会上传整页 HTML、URL、Cookie 或表单输入。可见文本中的姓名等内容若包含日文，也可能被当作待翻译文字。
- Key 使用 Tampermonkey 的 `GM_*Value` 存储，不用网页 `localStorage`；这是本地存储，并非加密保险箱。设置面板使用 closed Shadow DOM 隔离。仓库没有个人 Key，也没有后台服务或遥测。
- `@match` 仅允许 `https://app.abceed.com/*`，不在其他网站运行。`@connect *` 用于支持自定义 AI 域名；实际请求只发送给所配置的 HTTPS 地址，禁止重定向且不携带浏览器 Cookie。熟悉脚本的用户可将 `*` 缩小成自己的服务商域名。
- AI 返回值作为纯文本写入，不解析 HTML、不执行模型返回的代码。
- “清除 Key”会移除存储的 Key 并暂停；“清除缓存”不会撤销已显示中文。卸载脚本后刷新 abceed 恢复网站原貌。

## 开发与验证

需要 Node.js 22.22.2+（22 系列）、24.15.0+（24 系列）或 26+。

```sh
npm ci
npm run check
```

运行时没有第三方依赖。构建脚本将 `src/core.js`、`src/engine.js`、`src/main.js` 合并为 `dist/abceed-ai-translator.user.js`。`jsdom` 只用于开发测试。

```sh
npm run build
npm run demo
# 打开 http://127.0.0.1:4173
```

演示页使用自行编写的例句和**固定模拟响应**，没有真实 AI 调用，不代表翻译质量。自动化测试覆盖英语保护、协议错误、取消、可见性、缓存、动态节点、页面切换、文本安全和请求额度。真实服务商的连通性、费用及译文质量需要填入自己的 Key 后验证。

接口参考：[Tampermonkey API](https://www.tampermonkey.net/documentation.php)、[OpenRouter 兼容接口文档](https://openrouter.ai/docs/api_reference/overview)。

本项目与 abceed 无隶属关系。不提供付费教材、不绕过登录或订阅权限。

MIT License.
