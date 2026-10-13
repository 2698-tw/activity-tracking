# 2698 Data Extractor

Turns a screen recording of the game into rows in the tracking sheets.

**Open it:** https://2698-tw.github.io/activity-tracking/ (or https://data-collection.jk06nm04.workers.dev)
The home page has a card for each extractor: **Extract** opens it, **Open in Sheets** opens the sheet it fills.
Straight to one: add `#kartz` or `#cp` to the address.
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
   - Rows marked **confirm** need a decision: **✓** if the name is right as read, or **✎ Edit** to
     search the roster for the right player. **✕** removes a row that isn't a real player.
5. Press **Send to sheet**. When the button turns green, the rows are in
   **Kartz Tracker → Input-RawData** and the recording is saved to the Kartz videos folder.
   Keep the page open until it turns green.

## Base and March CP — the member list

Fill in **Submitter**, **Alliance** and **CP type** first; the CP type decides what comes next.

**Base CP — no recording**

1. Press **Fetch 698S members** (or whichever alliance is chosen). Every member on server 2698
   is fetched from the Global CP list (topwarfandom.com) with their current power.
   Players under 25M CP aren't in that list, and it updates about every 10 minutes.
2. Names are matched to the roster for the search-name column; the in-game name sent is the
   list's own. Rows marked **confirm** weren't a clear match: **✓** keeps one as a new player,
   **✎ Edit** lets you choose the right roster player (or fix the name).
3. Press **Send to sheet**. When the button turns green, the rows are in **Alliance Rosters**.

**March 1, 2 or 3 CP — from a recording**

1. **Record:** open the alliance **member list** and screen-record from the **very top**
   (including the first group header) to the bottom.
2. **Choose the recording** and press **Extract**.
3. **Check the results:**
   - The group check (e.g. *R3: 114 of 114*) should match every header. *Missing* means some
     cards were not read — record again more slowly; *more than its header* means a card was read
     twice — look for a near-duplicate and remove it with **✕**.
   - Settle any **confirm** rows the same way as on the Kartz tab.
4. Press **Send to sheet**. When the button turns green, the rows are in **Alliance Rosters**.

## Good to know

- **Remember my fixes** saves the names you corrected, so they match by themselves next time.
- **Open in Google Sheets ↗** under the green button jumps to the rows just sent.
- **Copy for sheet** and **Download CSV** are there if you ever need to paste rows by hand.
- Submitter and Alliance are remembered on each device and shared between the two tabs.
- The moon / sun button at the top right switches between light and dark mode.

Setting up or deploying the site: see `SETUP.md`. Background on how it works: `NOTES.md`.
