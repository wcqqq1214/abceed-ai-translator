const REPOSITORY = 'wcqqq1214/abceed-ai-translator';
export function newerVersion(candidate, current) {
  const parse = value => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
  const a = parse(candidate), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

export async function checkForUpdate(gmRequest, current) {
  const get = url => new Promise((resolve, reject) => {
    const fail = () => reject(new Error('检查失败，请稍后重试。'));
    gmRequest({ method: 'GET', url, anonymous: true, redirect: 'error', timeout: 10000,
      headers: { Accept: 'application/json' },
      onload: response => {
        if (response.status !== 200 || typeof response.responseText !== 'string' || response.responseText.length > 500000) { fail(); return; }
        resolve(response.responseText);
      }, onerror: fail, ontimeout: fail, onabort: fail });
  });
  const commits = JSON.parse(await get(`https://api.github.com/repos/${REPOSITORY}/commits?path=dist%2Fabceed-ai-translator.user.js&per_page=1`));
  const sha = commits?.[0]?.sha;
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('无法确认最新版本。');
  const url = `https://raw.githubusercontent.com/${REPOSITORY}/${sha}/dist/abceed-ai-translator.user.js`;
  const script = await get(url);
  const version = script.slice(0, 3000).match(/^\/\/ @version\s+(\d+\.\d+\.\d+)\s*$/m)?.[1];
  if (!version) throw new Error('无法确认最新版本。');
  return { version, url, available: newerVersion(version, current) };
}
