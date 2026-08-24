// vitest has no equivalent of Next.js's webpack/turbopack alias for the real "server-only"
// package (which isn't even an installed dependency — Next resolves it internally). Any module
// under test that starts with `import "server-only"` needs this no-op stub aliased in its place,
// or vitest fails to resolve the import before a single test runs.
export {};
