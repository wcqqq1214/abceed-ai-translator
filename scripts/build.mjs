import { readFile, writeFile, mkdir } from 'node:fs/promises';
const project = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', project), 'utf8'));
const repo = 'https://github.com/wcqqq1214/abceed-ai-translator';
const raw = 'https://raw.githubusercontent.com/wcqqq1214/abceed-ai-translator/main/dist/abceed-ai-translator.user.js';
const header = `// ==UserScript==
// @name         abceed AI 日文自动翻译
// @namespace    ${repo}
// @version      ${pkg.version}
// @description  用可配置的 AI 大模型将 abceed 可见日文自动替换为中文，保留英语原样。
// @author       wcqqq1214
// @license      MIT
// @match        https://app.abceed.com/*
// @run-at       document-idle
// @sandbox      DOM
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @homepageURL  ${repo}
// @supportURL   ${repo}/issues
// @downloadURL  ${raw}
// @updateURL    ${raw}
// ==/UserScript==
`;
const sources = await Promise.all(['core', 'cache', 'engine', 'words', 'main'].map(async name => {
  const source = await readFile(new URL(`src/${name}.js`, project), 'utf8');
  return source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
}));
await mkdir(new URL('dist/', project), { recursive: true });
await writeFile(new URL('dist/abceed-ai-translator.user.js', project), `${header}\n(() => {\n'use strict';\n${sources.join('\n')}\n})();\n`);
console.log(`Built abceed-ai-translator v${pkg.version}`);
