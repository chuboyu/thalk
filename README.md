# thalk

Personal publishing channel at [thalk.chuboyu.space](https://thalk.chuboyu.space). Design: [docs/thalk.design.md](docs/thalk.design.md).

## Writing

Add a markdown file to `site/content/posts/` with front matter (`title`, `date`, `description`, optional `draft: true`), commit, push. GitHub Actions builds and deploys.

## Commands

```sh
npm run build          # build site → dist/
npm run build:drafts   # include draft posts
npm run serve          # build with drafts + serve on :4173
firebase deploy --only functions,firestore   # deploy subscribe/support endpoints
```
