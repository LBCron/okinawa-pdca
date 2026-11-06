// 検索エンジンと SNS に向けた URL・sitemap・robots.txt・構造化データ（lib/seo.ts）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scriptJson } from '../src/lib/html.ts';
import { OG_IMAGE, absUrl, sitemapPaths, sitemapXml, robotsTxt, websiteLd, breadcrumbLd, duplicateHeads, planTextLd, llmsTxt } from '../src/lib/seo.ts';
import { KIHON_KEIKAKU } from '../src/lib/honbun.ts';
import { SITE, PROJECT } from '../src/lib/links.ts';

test('本番のドメインは https で、末尾にスラッシュがある', () => {
  assert.match(SITE.url, /^https:\/\/[^/]+\/$/);
});

test('サイトの中のパスを本番の完全な URL にする', () => {
  assert.equal(absUrl('/'), SITE.url);
  assert.equal(absUrl('/shisaku/1-1-a-1/'), `${SITE.url}shisaku/1-1-a-1/`);
  assert.equal(absUrl('/#themes'), `${SITE.url}#themes`);
});

test('SNS のカードの画像は public にあり、og:image:width・height に書く大きさと同じ', () => {
  // PNG の頭の IHDR に幅と高さがある（make og-image で作り直したときに大きさがずれないように）
  const png = readFileSync(new URL(`../public${OG_IMAGE.path}`, import.meta.url));
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [OG_IMAGE.width, OG_IMAGE.height]);
  assert.ok(OG_IMAGE.alt.includes(SITE.name) && OG_IMAGE.alt.includes(PROJECT.org));
});

test('sitemap にはページだけを入れ、ファイルと 404 は入れない', () => {
  const pages = ['', 'shisaku/1-1-a-1/', '404/', '404', 'torikumi/data.json', 'robots.txt', 'about/', 'about/'];
  assert.deepEqual(sitemapPaths(pages), ['/', '/about/', '/shisaku/1-1-a-1/']);
});

test('sitemap.xml は本番の URL を並べる', () => {
  const xml = sitemapXml(['/', '/about/']);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  assert.ok(xml.includes(`<url><loc>${SITE.url}</loc></url>`));
  assert.ok(xml.includes(`<url><loc>${SITE.url}about/</loc></url>`));
  assert.ok(sitemapXml(['/?a=1&b=2']).includes('?a=1&amp;b=2'));
});

test('題名・説明文がほかのページと同じページを、同じものごとにまとめて出す（ビルドで警告する）', () => {
  const page = (path: string, title: string, description: string) =>
    ({ path, html: `<head><title>${title}</title><meta name="description" content="${description}"></head>` });
  const pages = [page('/a/', 'A', '説明1'), page('/b/', 'A', '説明2'), page('/c/', 'C', '説明2'), page('/d/', 'D', '説明3')];
  assert.deepEqual(duplicateHeads(pages), [
    { kind: '題名', text: 'A', paths: ['/a/', '/b/'] },
    { kind: '説明文', text: '説明2', paths: ['/b/', '/c/'] },
  ]);
  assert.deepEqual(duplicateHeads(pages.slice(2)), []);
});

test('robots.txt は巡回を止めず、sitemap の場所を書く', () => {
  const txt = robotsTxt();
  assert.ok(!/^Disallow:\s*\S/m.test(txt));
  assert.ok(txt.includes(`Sitemap: ${SITE.url}sitemap.xml`));
});

test('JSON-LD の中の < は逃がす（</script> で閉じない）', () => {
  const s = scriptJson({ name: '</script><b>' });
  assert.ok(!s.includes('<'));
  assert.deepEqual(JSON.parse(s), { name: '</script><b>' });
});

test('WebSite は作り手を Code for Okinawa にし、県の資料はもとにしたものとして書く', () => {
  const ld = websiteLd('説明');
  assert.equal(ld['@type'], 'WebSite');
  assert.equal(ld.name, SITE.name);
  assert.equal(ld.alternateName, SITE.short);
  assert.equal(ld.url, SITE.url);
  assert.equal(ld.publisher.name, PROJECT.org);
  assert.ok(ld.isBasedOn.length > 0);
  for (const s of ld.isBasedOn) {
    assert.equal(s.author.name, '沖縄県');
    assert.match(s.url, /^https:\/\/www\.pref\.okinawa\.jp\//);
  }
});

test('ページの階層の BreadcrumbList は1から番号を振り、いまのページは here の URL にし、ページの無い段（施策展開）は入れない', () => {
  const ld = breadcrumbLd([{ href: '/future/1/', label: '将来像1' }, { label: '施策展開' }, { label: '施策' }], '/shisaku/1-1-a-1/');
  assert.deepEqual(ld.itemListElement, [
    { '@type': 'ListItem', position: 1, name: '将来像1', item: `${SITE.url}future/1/` },
    { '@type': 'ListItem', position: 2, name: '施策', item: `${SITE.url}shisaku/1-1-a-1/` },
  ]);
  // いまのページに href があっても here にする
  assert.equal(breadcrumbLd([{ href: '/future/', label: '計画' }, { href: '/kihon/1-1/', label: '基本施策' }], '/kihon/1-1/').itemListElement[1].item, `${SITE.url}kihon/1-1/`);
});

test('計画の本文のページの JSON-LD: 作り手は Code for Okinawa、もとにした計画の作り手は県、計画の期間は年度の4月から翌年3月まで', () => {
  const ld = planTextLd({ title: 'T', description: 'D', path: KIHON_KEIKAKU.href, plan: { name: KIHON_KEIKAKU.name, url: 'https://example.jp/a.pdf', fy: KIHON_KEIKAKU.fy, date: KIHON_KEIKAKU.date } });
  assert.equal(ld.url, `${SITE.url}21-seiki-vision/kihon/`);
  assert.equal(ld.publisher.name, PROJECT.org);
  assert.equal(ld.isBasedOn.author.name, '沖縄県');
  assert.equal(ld.isBasedOn.temporalCoverage, '2022-04/2032-03');
  assert.equal(KIHON_KEIKAKU.period, '令和4〜13年度');
});

test('llms.txt: サイトの名前の見出し・要約の引用・本番の URL のリンク', () => {
  const txt = llmsTxt({ ...KIHON_KEIKAKU, chapters: [{ title: '第１章 総説', path: '/21-seiki-vision/kihon/1.md' }] });
  assert.ok(txt.startsWith(`# ${SITE.name}\n\n> `));
  assert.ok(txt.includes(`- [第１章 総説](${SITE.url}21-seiki-vision/kihon/1.md)`));
  assert.ok(txt.includes(`(${SITE.url}pdca/)`));
  // リンクはすべて本番のドメイン
  for (const m of txt.matchAll(/\]\(([^)]+)\)/g)) assert.ok(m[1].startsWith(SITE.url), m[1]);
});
