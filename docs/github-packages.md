# Publishing to GitHub Packages

The package is `@1a8jkf/universal-resilience-toolkit`, publishing to
`https://npm.pkg.github.com`, associated with the private repository
`https://github.com/1a8jkf/universal-resilience-toolkit`.

## Metadata

Use `@1a8jkf/universal-resilience-toolkit` as the package name and
`git+https://github.com/1a8jkf/universal-resilience-toolkit.git` as the repository URL. Keep version
`0.1.0` for the first release. The owner and package name must be lowercase.
Update package-lock metadata, self-imports in tests, and documentation when renaming.

## Local authentication

The local `.npmrc` reads `NODE_AUTH_TOKEN` from the environment. It contains no literal
credential and is ignored by Git. `.npmrc.example` documents the configuration.
After the namespace is known, add its registry mapping to `.npmrc`:

```ini
@1a8jkf:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Use a fresh personal access token (classic) with `write:packages` for publication
and `read:packages` for installation. Authenticate locally; do not send credentials
through chat, put them in source files, or commit them. Account passwords are not
registry authentication tokens. Revoke any token that was shared in a conversation.

## GitHub Actions

The workflows use the repository's automatic `GITHUB_TOKEN` with `packages: write`.
No personal token needs to be copied into the workflow. Enable the repository variable
`ENABLE_GITHUB_PACKAGES=true` only when the scoped metadata and repository are ready.
The manual publication workflow derives the owner from the actual repository; the
Changesets workflow uses the final scoped name committed in `package.json`.

## Validate and publish

```sh
npm run check
npm publish --dry-run
npm publish
```

The dry run checks packaging and does not authenticate or prove permission to publish.
Verify the published version with `npm view @1a8jkf/universal-resilience-toolkit@0.1.0
version --registry=https://npm.pkg.github.com` and inspect the repository's Packages
section. Package visibility is managed in GitHub; it is not inferred from a successful
upload or from `publishConfig`.

Reference: [GitHub's npm registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).
