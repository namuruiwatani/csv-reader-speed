# csv-reader-speed-01 — a faster drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/namuruiwatani/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/namuruiwatani/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

`run(input)` returns exactly what csv-reader 1.0.0 returns — `{columns, rows, errors}` with the same
broken-row policy — in a fraction of the CPU time.

## Why it is faster

csv-reader 1.0.0 is written to be plain: one character at a time, every field built up with `+=`.
This reads the same text once, left to right, but

- slices a run of characters between delimiters instead of accumulating one character per step
  (`text.slice` once per field, no intermediate cons strings);
- reads the unquoted field — four fields in five — inline in the record loop, with no call of its own;
- finds a quoted field's closing quote with the native `indexOf`, so a quoted field's body is not
  walked by the interpreter at all unless it spans a line break;
- keeps the record's field array at the header's width and indexes into it, instead of growing an
  array per row.

The broken-row policy is unchanged, down to the order the errors are met: `stray_cr` where a CR is
dropped outside quotes, `quote_junk` when a field ends after its closing quote, `unterminated_quote`
with the text re-read as unquoted, and `short_row`/`long_row` when a record ends, each with the line
its record starts on and its index in `rows`.

## Verify

```sh
node main.ts        # reads /input/cases.json, writes /output/answers.json
```

`main.ts` is the competition's driver, unchanged: it turns V8's incremental marking off before
importing `solve.js`, reads every case, and writes the answers in the cases' order.

Checked for exact equality against csv-reader 1.0.0 on the kit's practice set (six cases, ~10 MB,
63,692 rows, 709,543 fields, 1,770 broken rows) and on 640,000 differential fuzz inputs covering
quotes that never close, `""` doubling, junk after a closing quote, lone CR, CRLF inside quotes, a
leading BOM, NUL and control characters.

## Licence

MIT — see [LICENSE](LICENSE). The reference reader it is compared against is make.fun's own
csv-reader 1.0.0 (MIT), derived from d3-dsv (ISC) and papaparse (MIT); no code from it is used here.
