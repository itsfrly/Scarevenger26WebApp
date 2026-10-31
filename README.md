# Scarevenger

Wrap-up page for the 2026 Halloween scavenger hunt at Desert Ridge: final
standings, a link to the Google Drive holding every team's photos and videos,
and *Ask Security*, a small point-and-click game where you find the mall's
security guards and ask to hold their gun.

## Layout

Plain static files, no build step:

- `site/index.html`: the page, with the standings written in directly
- `site/styles.css`
- `site/game.js`: the game, drawn as a single SVG scene

Open `site/index.html` in a browser to try it locally.

## Hosting

Cloudflare Pages, connected to this repo:

- Production branch: `main`
- Build command: none
- Build output directory: `site`

## The original app

The event itself ran on a full AWS app (CDK, Cognito, API Gateway, Lambda,
DynamoDB, S3, CloudFront). It's preserved on the `archive/aws-app` branch and
the `aws-app-final` tag.
