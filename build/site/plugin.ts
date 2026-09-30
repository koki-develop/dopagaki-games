import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { renderDocument } from './head.ts';
import { generateSite, NOT_FOUND_FILE } from './generate.ts';
import type { Site } from './generate.ts';
import { isPageRequest, resolvePage } from './resolve.ts';

const HTML = 'text/html; charset=utf-8';

function send(req: IncomingMessage, res: ServerResponse, status: number, contentType: string, body: Buffer | string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(req.method === 'HEAD' ? undefined : body);
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 308;
  res.setHeader('Location', location);
  res.end();
}

const requestUrl = (req: IncomingMessage) => new URL(req.url ?? '/', 'http://localhost');

/**
 * ページごとの HTML（題名・説明・canonical・OGP）、OG 画像、アイコン、sitemap.xml、robots.txt を配信物に加える。
 *
 * - ビルド: Vite が作った index.html（スクリプトやスタイルの読み込みが入ったもの）を元に、画面ごとの HTML を書き出す
 * - 開発サーバーとプレビュー: 本番（vercel.json）と同じ規則でリダイレクトと 404 を返し、同じ URL で同じ HTML を返す
 */
export function sitePlugin(): Plugin {
  // 開発サーバーでは、最初に要ったときに一度だけ作る。このファイルや、ここから読むファイルを変えると、Vite がサーバーを作り直す
  let site: Promise<Site> | null = null;
  const getSite = () => (site ??= generateSite());

  return {
    name: 'dopagaki:site',

    configResolved(config) {
      // 配信物のパスはすべてサイトのルートからの絶対パスで書くので、ルート以外に置く設定は受け付けない
      if (config.base !== '/') throw new Error(`base must be "/" (got "${config.base}")`);
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = requestUrl(req);
        void (async () => {
          const s = await getSite();
          const file = s.files.find((f) => f.path === url.pathname);
          if (file) return send(req, res, 200, file.contentType, file.body);
          if (!isPageRequest(req.method, req.headers.accept, url.pathname)) return next();

          const r = resolvePage(url.pathname, url.search);
          if (r.kind === 'redirect') return redirect(res, r.location);
          const template = await readFile(join(server.config.root, 'index.html'), 'utf8');
          const html = await server.transformIndexHtml('/index.html', template, req.originalUrl);
          send(req, res, r.status, HTML, renderDocument(html, s.documentFor(r.route)));
        })().catch(next);
      });
    },

    configurePreviewServer(server) {
      // 画面ごとの HTML・画像・sitemap はビルドで書き出してあり、Vite がそのまま返す。
      // Vite のプレビューは知らないパスに index.html を 200 で返すので、リダイレクトと 404 だけをここで本番に合わせる
      const outDir = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((req, res, next) => {
        const url = requestUrl(req);
        if (!isPageRequest(req.method, req.headers.accept, url.pathname)) return next();
        const r = resolvePage(url.pathname, url.search);
        if (r.kind === 'redirect') return redirect(res, r.location);
        if (r.status === 200) return next();
        readFile(join(outDir, NOT_FOUND_FILE)).then((body) => send(req, res, 404, HTML, body), next);
      });
    },

    generateBundle: {
      // Vite が index.html を書き出し終えたあとに動かす
      order: 'post',
      async handler(_, bundle) {
        const index = bundle['index.html'];
        if (index?.type !== 'asset' || typeof index.source !== 'string') throw new Error('index.html is not in the bundle');
        const template = index.source;
        const s = await getSite();
        for (const page of s.pages) {
          const html = renderDocument(template, page.doc);
          if (page.fileName === 'index.html') index.source = html;
          else this.emitFile({ type: 'asset', fileName: page.fileName, source: html });
        }
        for (const file of s.files) this.emitFile({ type: 'asset', fileName: file.path.slice(1), source: file.body });
      },
    },
  };
}
