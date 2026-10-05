# 2698 Data Extractor

Turns a screen recording of the game into rows in the tracking sheets.

**Open it:** https://data-collection.jk06nm04.workers.dev
On a phone, use **Share → Add to Home Screen** so it opens like an app.

## First time on a device

1. Press **Pull / Update Alliance Roster**. The badge turns green with the number of names.
2. Pull again whenever players join or change names.

## Kartz tab — the Ranking list

1. **Record:** open the event's **Ranking** list and screen-record while scrolling from the top
   to the bottom. Scroll steadily, not in fast flicks.
2. **Choose the recording** and fill in **Submitter**, **Alliance** and **Day**.
3. Press **Extract** and wait for the results.
4. **Check the results:**
   - A yellow banner about missing ranks means part of the list was not read — record that
     stretch again more slowly.
   - Rows marked **confirm** need a decision: **✓** if the name is right as read, or **✎** to
     search the roster for the right player. **✕** removes a row that isn't a real player.
5. Press **Send to sheet**. When the button turns green, the rows are in
   **Kartz Tracker → Input-RawData** and the recording is saved to the Kartz videos folder.
   Keep the page open until it turns green.

## Base CP tab — the member list

1. **Record:** open the alliance **member list** and screen-record from the **very top**
   (including the first group header) to the bottom.
2. **Choose the recording** and fill in **Submitter**, **Alliance** and **CP type**
   (Base, March 1, March 2 or March 3).
3. Press **Extract**.
4. **Check the results:**
   - The group check (e.g. *R3: 114 of 114*) should match every header. *Missing* means some
     cards were not read — record again more slowly; *more than its header* means a card was read
     twice — look for a near-duplicate and remove it with **✕**.
   - Settle any **confirm** rows the same way as on the Kartz tab.
5. Press **Send to sheet**. When the button turns green, the rows are in **Alliance Rosters**.

## Good to know

- **Remember my fixes** saves the names you corrected, so they match by themselves next time.
- **Open in Google Sheets ↗** under the green button jumps to the rows just sent.
- **Copy for sheet** and **Download CSV** are there if you ever need to paste rows by hand.
- Submitter and Alliance are remembered on each device and shared between the two tabs.
- The moon / sun button at the top right switches between light and dark mode.

Setting up or deploying the site: see `SETUP.md`. Background on how it works: `NOTES.md`.
