# thalk

Personal publishing channel at [thalk.chuboyu.space](https://thalk.chuboyu.space).

- **Operator's manual** (serve, build, publish, deploy, newsletter): [docs/manual.md](docs/manual.md)
- **Design**: [docs/thalk.design.md](docs/thalk.design.md) · **i18n**: [docs/thalk.i18n.md](docs/thalk.i18n.md)

## Writing

Add a markdown file under `site/content/<lang>/posts/` (`en` and `zh`) with front matter (`key`, `lang`, `title`, `date`, `description`, optional `draft: true`), commit, push. GitHub Actions builds and deploys. Every post is expected in both `en` and `zh` unless marked `solo: true`. See [docs/manual.md](docs/manual.md) for details.

## Commands

```sh
npm run serve          # build with drafts + serve on :4173
npm run build          # i18n gate, then build → dist/ (production)
npm run build:drafts   # include draft posts, skip the gate
npm run newsletter:dry # preview what a newsletter run would send
firebase deploy --only functions --project thalk-1c092   # deploy backend endpoints
```
