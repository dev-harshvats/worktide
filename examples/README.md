# WorkTide Examples 🚀

This directory contains reference examples for using WorkTide across typical developer and automated agent workflows.

---

## 1. Parallel Feature Development

When building a new feature branch alongside your current work:

```bash
# In your main repository directory:
worktide start feature/checkout-redesign

# Output:
# ✓ Provisioned worktree at ../myrepo-feature-checkout-redesign
# ✓ Symlinked node_modules from main checkout
# ✓ Injected PORT=3010, PORT_END=3019 into .env.local
```

You can now immediately `cd ../myrepo-feature-checkout-redesign` and run `npm run dev`. Your dev server will automatically bind to port `3010`, completely isolated from your main branch running on port `3000`.

---

## 2. Inspecting Multi-Branch Status

Check all active branches across ports in real time:

```bash
worktide status
```

Example output:

| Branch | Slug | Path | Ports | Status |
|---|---|---|---|---|
| `main` | `main` | `/Users/dev/myrepo` | 3000-3009 | `live` |
| `feature/checkout-redesign` | `feature-checkout-redesign` | `/Users/dev/myrepo-feature-checkout-redesign` | 3010-3019 | `live` |
| `fix/navbar-bug` | `fix-navbar-bug` | `/Users/dev/myrepo-fix-navbar-bug` | 3020-3029 | `down` |

---

## 3. Safe Teardown

When your PR is merged or the feature is complete:

```bash
worktide done feature/checkout-redesign
```

WorkTide will:
1. Verify no uncommitted changes exist (preventing accidental code loss).
2. Terminate any listening dev processes on ports 3010-3019.
3. Remove the git worktree and prune git metadata.
4. Return ports 3010-3019 to the free pool for reuse.
