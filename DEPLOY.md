# Deploying the Ethara Service Hub

## Always deploy with

```bash
npm run deploy
```

Never run `npm run build` on its own against production.

## Why

`next build` writes straight into `.next-build`, which is the exact directory
the running server reads from. Client bundles are content-hashed, so a build
renames the app's main chunk — for example `page-7890d40b….js` becomes
`page-7e8a20bb….js`.

The live server keeps its build manifest in memory from when it started, so the
instant a build finishes it is serving HTML that points at a chunk filename the
build just deleted. The browser gets a 404 for the app's JavaScript and, because
the UI is client-rendered, shows:

> The application could not load

The build reports success, the service is `active`, and the database is fine —
but every page load fails until the process is restarted. If the restart is
delayed or fails, the site stays down with a green build.

## What `npm run deploy` does instead

1. Builds into `.next-stage`, so `.next-build` is untouched. A failed build now
   changes nothing.
2. Boots the staged build on port 3021 and checks that `/` returns 200 **and**
   that the main chunk referenced in its HTML also returns 200 — the precise
   condition that broke the site before. Only `/` is requested, which is
   statically prerendered, so the smoke test touches no database.
3. Swaps `.next-stage` into `.next-build`, keeping the old build as
   `.next-build.prev`. This takes about a second rather than the length of a
   build.
4. Restarts `tms.service`.
5. Re-runs the same page + chunk check against the live site, and rolls back to
   `.next-build.prev` and restarts if it fails.

Steps 3 and 4 are adjacent, so the window where the on-disk build and the
running process disagree is seconds, and any failure restores the previous
build automatically.

## Rollback

`.next-build.prev` holds the previous build:

```bash
cd /home/ec2-user/TMS/TMS/TMS
rm -rf .next-build && mv .next-build.prev .next-build
sudo systemctl restart tms.service
```

## Health check

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3010/
CHUNK=$(curl -s http://127.0.0.1:3010/ | grep -oE 'static/chunks/app/page-[a-z0-9]+\.js' | head -1)
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:3010/_next/$CHUNK"
```

Both must be `200`. A 200 on the page with a 404 on the chunk is the failure
described above.

## A note on directory names

The standalone server does `process.chdir(__dirname)` and resolves `distDir`
relative to itself, which is why a tree built as `.next-stage` runs correctly
once moved to `.next-build`. The consequence is that the build output nested
inside the live tree is named after the directory it was built in:

```
.next-build/standalone/.next-stage/{server,static}
```

That is expected and stable — every deploy builds in `.next-stage`. When
inspecting a bundle, locate it rather than assuming the name:

```bash
find .next-build/standalone -name route.js -path '*api*'
find .next-build/standalone -type d -name chunks
```
