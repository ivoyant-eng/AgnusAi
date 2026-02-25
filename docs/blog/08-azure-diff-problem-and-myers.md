# The Algorithm That Powers GitHub — And How We Used It to Fix AgnusAI

> **TL;DR** — Azure DevOps doesn't give you a diff. It gives you two file snapshots and says "figure it out yourself." Our first attempt with LCS worked fine for small files but silently broke on large ones, causing AgnusAI to comment on code that wasn't even changed in the PR. Here's how we caught it, why it happened, and how switching to Myers diff (Git's own algorithm) fixed it.

---

## The GitHub Assumption

When we built the GitHub adapter for AgnusAI, getting the diff was trivial. GitHub's Pull Requests API returns a `patch` field directly on each changed file — a standard unified diff you can send straight to the LLM:

```
@@ -42,7 +42,7 @@
 const foo = bar;
-const result = oldFunction();
+const result = newFunction();
 return result;
```

Lines prefixed with `+` are additions. Lines with `-` are removals. Lines with a space are context. Simple, reliable, and exactly what a code reviewer needs.

We sent this to the LLM with instructions to comment only on `+` lines, and it worked.

---

## What Azure DevOps Actually Gives You

When we added Azure DevOps support, we hit an immediate wall.

Azure DevOps doesn't have a diff endpoint in the same sense. The [Pull Request Iteration Changes API](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iteration-changes/get?view=azure-devops-rest-7.1) returns a list of changed *files* — just metadata:

```json
{
  "changeEntries": [
    {
      "item": { "path": "/src/components/ActivityComponent/index.tsx" },
      "changeType": "edit"
    }
  ]
}
```

That's it. No patch. No line numbers. No `+` or `-`.

To get the actual content, you have to:

1. Call the [Iterations API](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iterations?view=azure-devops-rest-7.1) to find the source commit (the PR's latest push) and the merge base commit (where it branched from)
2. Call the [Items API](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/items/get?view=azure-devops-rest-7.1) **twice per file** — once for each commit — to fetch raw file content:
   ```
   GET /_apis/git/repositories/{id}/items
     ?path=/src/components/ActivityComponent/index.tsx
     &versionDescriptor[versionType]=commit
     &versionDescriptor[version]={commitId}
   ```
3. Compute the diff yourself

So for a PR with 20 changed files, that's 40 API calls just to get file content, plus your own diff computation. GitHub does all of this for you server-side and returns a patch. Azure makes you do it client-side.

---

## Our First Solution: LCS

Computing a diff from two strings is a classic CS problem — find the **Longest Common Subsequence (LCS)** between the old and new lines, and everything not in the LCS is either an addition or deletion.

The DP approach is straightforward:

```typescript
const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
for (let i = 1; i <= m; i++) {
  for (let j = 1; j <= n; j++) {
    dp[i][j] = oldLines[i-1] === newLines[j-1]
      ? dp[i-1][j-1] + 1
      : Math.max(dp[i-1][j], dp[i][j-1]);
  }
}
```

Time complexity: O(m × n). Space complexity: O(m × n).

For small files, this worked perfectly. AgnusAI was producing correct diffs, the LLM was seeing the right lines, and reviews looked good.

---

## The Silent Bug

The problem appeared when reviewing PRs that touched large files — think 700+ line React components.

For a 750-line file, `m × n = 750 × 750 = 562,500`. Still under our safety threshold of 600,000. Fine.

But a 780-line old file against a 790-line new file? `780 × 790 = 616,200`. Over threshold.

We had added a fallback for this case:

```typescript
if (m * n > 600_000) {
  return [
    ...oldLines.map((c, i) => ({ type: 'remove', oldLine: i + 1, newLine: 0, content: c })),
    ...newLines.map((c, i) => ({ type: 'add',    oldLine: 0, newLine: i + 1, content: c })),
  ];
}
```

**The fallback treated the entire file as deleted and re-added from scratch.**

Every line in the new file became a `+` line. The diff we sent to the LLM looked like the entire component was brand new. The LLM dutifully reviewed it — including code that existed unchanged for months.

The result: AgnusAI posting comments like "The raw comparison of user email to determine admin access introduces a security issue" on `User?.email == "admin@ivoyant.com"` — a line that had nothing to do with this PR.

The worst part: it looked plausible. The comment was technically correct about the code. It just had nothing to do with the PR.

---

## Catching It

We noticed it while reviewing an Azure DevOps PR for a production codebase. A comment appeared at line 196 of `ActivityComponent/index.tsx`. Looking at the actual PR diff in Azure DevOps, line 196 was highlighted grey — a context line, not a changed line.

The comment balloon was sitting right on unchanged code.

Once we understood the fallback, the cause was obvious. The 600K threshold wasn't based on correctness — it was just a performance escape hatch. We'd traded correctness for speed and didn't even notice because small files always worked fine.

---

## The Fix: Myers Diff

The right answer is the algorithm Git itself uses: **Myers diff**.

Eugene Myers published it in 1986. It finds the shortest edit script between two sequences in **O(N·D)** time, where:
- `N` = total lines in both files combined
- `D` = number of actual differences (edit distance)

For a typical PR where only a few dozen lines changed in a 800-line file, `D` is small and the algorithm is extremely fast — far faster than O(m×n) DP even for large files.

The key insight of Myers: instead of building an LCS table, find the **shortest path through an edit graph** where:
- Moving right = delete a line from the old file
- Moving down = insert a line from the new file
- Moving diagonally = lines match (free move)

The algorithm uses a compact `V` array indexed by "diagonal" `k = x - y` (position in old file minus position in new file) to track the furthest reachable point at each edit distance `d`:

```typescript
const V = new Int32Array(2 * max + 2).fill(-1);
V[1 + offset] = 0;

for (let d = 0; d <= max && !found; d++) {
  trace.push(new Int32Array(V));  // store for backtracking
  for (let k = -d; k <= d; k += 2) {
    // choose: insertion (down) or deletion (right)?
    let x = (k === -d || (k !== d && V[k-1+offset] < V[k+1+offset]))
      ? V[k+1+offset]       // insertion
      : V[k-1+offset] + 1;  // deletion
    let y = x - k;
    // follow the snake (matching lines)
    while (x < m && y < n && eq(x, y)) { x++; y++; }
    V[k + offset] = x;
    if (x >= m && y >= n) { found = true; break; }
  }
}
```

After the forward pass, we backtrack through the stored `trace` to reconstruct the edit list — exactly which lines were added, removed, or unchanged.

We also added **FNV-1a line hashing** to speed up the equality check `eq(x, y)`. Instead of comparing full string content on every step, we pre-hash each line and compare integers:

```typescript
const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
```

Hash collision is theoretically possible but astronomically unlikely for source code lines. We verify with a full string comparison when hashes match to be safe.

The only remaining fallback: if the edit distance `d` exceeds 8,000 (completely unrelated files — almost never happens in real PRs), we still fall back to full-replacement. But now it's based on actual edit distance, not a proxy like file size.

---

## One More Fix: Teaching the LLM Which Lines It Can Comment On

Even with a correct diff, the LLM would still see context lines (unchanged code around the changes) and sometimes comment on them. The diff format is subtle — a leading space means context, `+` means addition, `-` means removal. LLMs don't always respect that distinction reliably.

We solved this by changing how we present the diff to the LLM. Instead of:

```
@@ -379,14 +379,14 @@
 ? // custom set of menu
   ([
+    // {
+    //   key: "Edit",
 ] as MenuProps["items"])
```

We now annotate each `+` line with its explicit file line number and strip context lines entirely:

```
@@ -379,14 +381,12 @@
[Line 381] +    // {
[Line 382] +    //   key: "Edit",
-    { key: "Edit", label: "Edit", onClick: editActivity }
```

The LLM sees `[Line 381]` and uses exactly that number. Context lines don't appear at all — the LLM physically can't comment on them because it never sees them. Removed lines (`-`) stay for context so the LLM understands what changed, but they carry no line number annotation.

The prompt rule is now unambiguous:

> Every added line is prefixed with `[Line N]` showing its exact file line number. Use ONLY those numbers. Lines starting with `-` are removals shown for context — do NOT place a comment on them.

And as a final safety net, `postReview` validates every comment's line number against the actual set of `+` lines in the diff before posting to the VCS.

---

## Lessons

**Azure DevOps is not GitHub.** The APIs look similar on the surface but the PR diff model is fundamentally different. GitHub is diff-first; Azure DevOps is commit-first. If you're building a tool that works across both, you need to treat them differently — not as a thin adapter over a common interface.

**Silent correctness failures are the worst kind.** The LCS fallback never threw an error. The diff was syntactically valid. The LLM produced coherent-sounding comments. The only way to catch it was to look at a real PR and notice that the comments were landing on the wrong code.

**Threshold-based fallbacks hide correctness problems.** "Treat large files as full replacement" is a performance optimisation that trades correctness for speed. In a code review context, correctness is the entire point. Myers diff removes the need for that trade-off entirely.

---

## Further Reading

- [Myers, E.W. (1986) — An O(ND) Difference Algorithm and Its Variations](http://www.xmailserver.org/diff2.pdf) — the original paper
- [Azure DevOps: Pull Request Iterations API](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iterations?view=azure-devops-rest-7.1)
- [Azure DevOps: Pull Request Iteration Changes API](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iteration-changes/get?view=azure-devops-rest-7.1)
- [Azure DevOps: Git Items API](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/items/get?view=azure-devops-rest-7.1)
- [James Coglan's excellent series on Myers diff](https://blog.jcoglan.com/2017/02/12/the-myers-diff-algorithm-part-1/) — best explanation of the algorithm with visualisations
