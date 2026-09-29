// Restrict the local Chinese face to CJK so Latin text keeps the site's font.
const CHINESE_FACE = 'Abceed AI Chinese';
// local() resolves full/PostScript face names, not reliably family names.
const CHINESE_FONT_CSS = [
  ['100 300', ['PingFangSC-Light', 'PingFang SC Light', 'Microsoft YaHei Light', 'NotoSansCJKsc-Light']],
  ['400', ['PingFangSC-Regular', 'PingFang SC Regular', 'Microsoft YaHei', 'NotoSansCJKsc-Regular', 'NotoSansSC-Regular', 'SourceHanSansSC-Regular']],
  ['500', ['PingFangSC-Medium', 'PingFang SC Medium', 'Microsoft YaHei', 'NotoSansCJKsc-Medium']],
  ['600 900', ['PingFangSC-Semibold', 'PingFang SC Semibold', 'MicrosoftYaHei-Bold', 'Microsoft YaHei Bold', 'NotoSansCJKsc-Bold', 'SourceHanSansSC-Bold']]
].map(([weight, faces]) => `@font-face{font-family:"${CHINESE_FACE}";font-weight:${weight};src:${faces.map(face => `local("${face}")`).join(',')};unicode-range:U+3000-303F,U+3400-4DBF,U+4E00-9FFF,U+F900-FAFF,U+FF00-FFEF,U+20000-323AF;}`).join('\n');
const typographyDocuments = new WeakSet();

export function styleChineseTranslation(node, win) {
  // Attribute labels and canvas adapters have no independent text styling surface.
  if (node.nodeType !== 3 || !/\p{Script=Han}/u.test(node.nodeValue)) return;
  const element = node.parentElement;
  if (!element?.style) return;
  const doc = element.ownerDocument;
  if (!typographyDocuments.has(doc)) {
    const style = doc.createElement('style');
    style.textContent = CHINESE_FONT_CSS;
    (doc.head || doc.documentElement).append(style);
    typographyDocuments.add(doc);
  }
  const family = win.getComputedStyle(element).fontFamily;
  if (!family.includes(CHINESE_FACE)) element.style.fontFamily = `"${CHINESE_FACE}", ${family || 'sans-serif'}`;
  element.setAttribute('lang', 'zh-CN');
}
