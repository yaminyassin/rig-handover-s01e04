---
name: preview-upload
description: Put one saved rig page on a public link for review, upload over it without the lane marker, and take it down. Use for a plan's "Preview for review" and "Clean up" issues (ADR 0003).
---

# preview-upload

One HTML file on a public gist, read through its raw link. Needs `gh`, signed in. Ask the human
before each step that puts something on the link.

## Steps

1. Save the page with a command, not a browser. Keep the file outside the repo (ADR 0003).

   ```sh
   pnpm start &                      # .env sets LANE_MARKER
   curl -sS -o <out>/<page>.html localhost:8787/digest/<night>
   ```

2. Put it up (first time). gh prints the gist URL; the id is its last part.

   ```sh
   gh gist create --public -d "rig preview: <page>" <out>/<page>.html
   ```

   The link to send is the raw link without a revision, so it always serves the latest upload:
   `https://gist.githubusercontent.com/<login>/<id>/raw/<page>.html`

3. Check the link the way the reviewer reads it, before you send it: a plain fetch, no browser.

   ```sh
   curl -sS <raw link> | cmp - <out>/<page>.html
   ```

4. Leave the preview issue open until the reviewer has looked. Sent is not reviewed.

5. Clean up, once the review is in: save the page again with the marker unset, upload over the
   same link, fetch it again.

   ```sh
   LANE_MARKER= pnpm start &         # banner reads "no marker set"
   curl -sS -o <out>/<page>.clean.html localhost:8787/digest/<night>
   gh api -X PATCH gists/<id> -F "files[<page>.html][content]=@<out>/<page>.clean.html"
   curl -sS <raw link> | grep -c '<marker>'      # must print 0
   ```

6. Take it down when nobody needs the link any more:

   ```sh
   gh gist delete <id> --yes
   ```

## Know before you pick this

- The raw link serves `text/plain`: fine for a reviewer that reads the HTML, not a rendered page.
- A gist keeps old revisions. The marked copy stays reachable by its revision link until the
  gist is deleted (step 6).
- A link that only renders in a browser (an app that loads the page in a frame) is not a preview:
  a plain fetch gets the wrapper, not the page.
- Never the repo, an issue or a chat attachment (ADR 0003).
