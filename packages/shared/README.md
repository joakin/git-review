# Shared contracts

Runtime-neutral TypeScript consumed by web and agent through explicit subpath exports in
[package.json](package.json). This package has no host-runtime or third-party dependencies; it does
not import either application.

Keep a wire contract and its validating parser together. Consumers treat external data as unknown
and use parsed domain values internally. Reuse [validation](src/validation.ts) for generic checks;
domain parsers remain with their own formats.

[API](src/api.ts), [agent information](src/agent-info.ts), [Git](src/git.ts),
[feedback checks](src/feedback-check.ts), [diff context](src/diff-context.ts), and
[media](src/media-types.ts) own their exact shapes and limits.
[ResourceCache](src/resource-cache.ts) shares bounded retention mechanics; callers retain identity,
freshness, and invalidation policy.

See [development conventions](../../docs/current/development.md) for dependency boundaries and
[architecture](../../docs/current/architecture.md) for lifetimes.
