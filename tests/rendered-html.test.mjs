import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("화면 주석 도구의 핵심 접근성 계약을 서버 렌더링한다", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Point — 화면 주석 도구<\/title>/i);
  assert.match(html, /role="toolbar"/);
  assert.match(html, /aria-label="화면 주석 도구"/);
  assert.match(html, /aria-label="화면 주석 드로잉 영역"/);
  assert.match(html, /aria-label="펜, 단축키 P"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("드로잉·스냅·popover와 디자인 토큰 계약을 유지한다", async () => {
  const [page, css, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /^"use client";/);
  assert.match(page, /setPointerCapture/);
  assert.match(page, /getCoalescedEvents/);
  assert.match(page, /SNAP_THRESHOLD = 56/);
  assert.match(page, /role="radiogroup"/);
  assert.match(page, /role="switch"/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /requestAnimationFrame/);

  assert.match(css, /--accent:\s*#0a84ff/i);
  assert.match(css, /--danger:\s*#ff453a/i);
  assert.match(css, /--success:\s*#30d158/i);
  assert.match(css, /rgba\(28, 28, 30, 0\.82\)/);
  assert.match(css, /Segoe UI Variable/);
  assert.match(css, /backdrop-filter:\s*blur\(18px\)/);
  assert.match(css, /border-radius:\s*20px/);
  assert.match(css, /width:\s*40px/);
  assert.match(css, /gap:\s*7px/);
  assert.match(css, /scale\(0\.96\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /prefers-reduced-transparency:\s*reduce/);

  assert.match(layout, /lang="ko"/);
  assert.match(layout, /const title = "Point — 화면 주석 도구"/);
  assert.match(layout, /const imageUrl = `\$\{origin\}\/og\.png`/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview|_sites-preview/);
  assert.match(packageJson, /"lucide-react"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
});
