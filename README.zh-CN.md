# PDFGist

本地优先的 AI PDF 阅读器，翻译与总结开箱即用——接入你自己的大模型 API。兼容任何 OpenAI 协议端点：OpenAI、DeepSeek、Kimi、硅基流动、Ollama（本地）等。基于 Tauri 2 + PDF.js 构建。

![license](https://img.shields.io/badge/license-AGPL--3.0-blue) ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey) ![built with](https://img.shields.io/badge/built%20with-Tauri%202-orange)

[English](README.md) · **中文**

大多数 AI PDF 应用把你锁进它们的订阅。PDFGist 反其道而行：应用本身只是一个轻快的阅读器，智能来自你自己指定的模型。你的 Key、你的模型、你的账单——Key 保存在本机，请求直达你选择的服务商，除此之外没有任何数据离开你的机器。

## 功能

- **PDF 阅读**——连续滚动、缩放/适宽、文档目录、键盘导航
- **划词翻译**——选中任意文本，一键翻译，流式输出
- **页面与全文总结**——当前页、选区或整份文档的一键结构化总结
- **与文档对话**——基于当前页、选区或文档前若干页提问
- **自带模型**——预置智谱 GLM（含 GLM Coding 套餐专属端点）、DeepSeek、Moonshot Kimi、通义千问、豆包（火山方舟）、硅基流动、Ollama，或任意 OpenAI 兼容 Base URL；模型列表按需拉取
- **本地优先**——设置与 API Key 保存在用户配置目录；无账号，无遥测
- **在线更新**——启动时与设置页检查更新，GitHub Releases 分发签名更新包，应用内一键更新重启

## 从源码构建

前置要求：Node.js 22+、Rust，以及所在平台的 [Tauri 2 依赖](https://tauri.app/start/prerequisites/)。

```bash
npm install
npm run tauri dev    # 开发
npm run tauri build  # 打包安装程序
```

修改 `scripts/make-icon.mjs` 后重新生成应用图标：

```bash
npm run icon
```

## 路线图

- [ ] 文档内搜索
- [ ] 双语对照视图
- [ ] 批量翻译导出（Markdown）
- [ ] 扫描件 OCR
- [ ] EPUB 支持
- [ ] 笔记导出（Markdown，对 Obsidian 友好）

## 许可证

[AGPL-3.0](LICENSE)
