import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const script = await readFile(new URL('../dist/abceed-ai-translator.user.js', import.meta.url), 'utf8');
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>abceed AI — 本地模拟验证</title>
<style>body{font:17px system-ui;max-width:850px;margin:50px auto;padding:0 22px;color:#203631;background:#f5f7f4}header{margin-bottom:32px}h1{font-size:28px}article{padding:30px;background:white;border:1px solid #dce4dc;border-radius:18px}button{padding:10px 18px;cursor:pointer}aside{color:#62706a;font-size:14px}p{line-height:1.8}.spacer{height:950px}</style>
<header><aside translate="no">本地模拟验证 · 使用固定测试响应，不调用真实 AI</aside><aside translate="no" id="request-count">本次页面模拟 AI 请求：0 次</aside><h1>英語の練習</h1></header>
<article><h2 id="heading">問題</h2><p id="english">The meeting has been postponed until Friday.</p><p id="mixed">「postponed」は過去分詞です。</p><p id="japanese">正しい答えを選んでください。</p><button id="reveal" type="button">解説を見る</button><p id="explanation" hidden>この文は受動態です。</p></article>
<div style="margin-top:20px"><button role="tab" aria-label="学習時間" style="position:relative"><span style="visibility:hidden">学習時間</span></button> <select aria-label="Period"><option value="7d">1週間</option><option value="all">すべて</option></select></div><style>[role=tab]::before{content:attr(aria-label);position:absolute;inset:10px 18px}</style><div class="spacer"></div><p id="offscreen">次の問題</p>
<script>
const memory = new Map([['config',{endpoint:'https://demo.invalid/v1/chat/completions',model:'mock-only',enabled:true}],['apiKey','demo-not-a-real-key']]);
window.GM_getValue=(key,fallback)=>key==='translationCache'?JSON.parse(localStorage.getItem('abceed-ai-demo-cache')||'null'):memory.has(key)?memory.get(key):fallback;
window.GM_setValue=(key,value)=>key==='translationCache'?localStorage.setItem('abceed-ai-demo-cache',JSON.stringify(value)):memory.set(key,value);
window.GM_deleteValue=key=>memory.delete(key);
window.GM_registerMenuCommand=()=>{};
let requestCount=0;
window.GM_xmlhttpRequest=options=>{
  document.querySelector('#request-count').textContent='本次页面模拟 AI 请求：'+(++requestCount)+' 次';
  const {entries=[],word,text}=JSON.parse(JSON.parse(options.data).messages[1].content);
  const dictionary={'学習時間':'学习时间','1週間':'1周','すべて':'全部','英語の練習':'英语练习','問題':'题目','正しい答えを選んでください。':'请选择正确答案。','解説を見る':'查看解析','この文は受動態です。':'这句话使用了被动语态。','次の問題':'下一题'};
  const translations=entries.map(({id,text})=>({id,text:dictionary[text]||text.replace('は過去分詞です。','是过去分词。').replace('週間','周')}));
  const timer=setTimeout(()=>options.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(text?{translation:"会议已推迟到星期五。"}:word?{meaning:"动词：推迟，延期。"}:{translations})}}]})}),250);
  return {abort(){clearTimeout(timer);options.onabort();}};
};
document.querySelector('#reveal').onclick=()=>{document.querySelector('#explanation').hidden=false;};
</script><script src="/userscript.js"></script></html>`;
const server = createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/userscript.js') { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', req.url === '/' ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8');
  res.end(req.url === '/' ? html : script);
});
server.listen(4173, '127.0.0.1', () => console.log('Mock-only demo: http://127.0.0.1:4173 (no provider requests)'));
