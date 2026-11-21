# csv-reader-speed-01 — a byte-level drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/namuruiwatani/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/namuruiwatani/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

`run(input)` returns exactly what csv-reader 1.0.0 returns — `{columns, rows, errors}` with the same
broken-row policy, down to the order the errors are met.

## The trick: the text is already JSON

In `/input/cases.json` every case's `text` is a JSON string body, so its bytes are valid JSON content as
they stand: a `"` in the CSV is the two bytes `\"`, a newline is `\n`, a backslash is `\\`. The fast path
(`fast2.js`) therefore

- never unescapes the text and never escapes it again: it reads the CSV **over the escaped bytes** —
  `\"` opens or closes a quoted field, `\n` and `\r` end a record, a comma is a comma — and copies each
  field's bytes straight into the answer, where they are already valid JSON;
- collapses `""` to `\"` and a CR inside quotes to `\n` by writing those two bytes, nothing more;
- builds the whole `answers.json` in one buffer, with no JS string per field, no `JSON.parse`, no
  `JSON.stringify`, and no object or array per field.

`solve.js` is the character-level reader and the fallback: `main.ts` answers the whole run with it
whenever the fast path answers null. It is exact for every input by construction.

## The broken-row policy

Unchanged from csv-reader 1.0.0: `stray_cr` where a CR is dropped outside quotes, `quote_junk` when a field
ends after its closing quote, `unterminated_quote` with the text re-read as unquoted, and
`short_row`/`long_row` when a record ends, each carrying the line its record starts on and its index in
`rows`; a U+FEFF at the very start of the text is dropped; a blank line is no record.

## Verify

```sh
node main.ts        # reads /input/cases.json, writes /output/answers.json
```

Checked for exact equality against csv-reader 1.0.0 on the kit's practice set (six cases, ~10 MB, 63,692
rows, 709,543 fields, 1,770 broken rows) and on 12,000 differential fuzz inputs covering quotes that never
close, `""` doubling, junk after a closing quote, lone CR, CRLF inside quotes, a leading BOM, NUL and
control characters.

## Licence

MIT — see [LICENSE](LICENSE). The reference reader it is compared against is make.fun's own csv-reader
1.0.0 (MIT), derived from d3-dsv (ISC) and papaparse (MIT); no code from it is used here.
