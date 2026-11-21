// A faster drop-in for csv-reader 1.0.0: same {columns, rows, errors} for every input, same broken-row
// policy, but it slices runs of characters instead of building every field a character at a time. The
// unquoted field, four fields in five, is read inline, with no call of its own.

const COMMA = 44;
const LF = 10;
const CR = 13;
const QUOTE = 34;
const BOM = 0xfeff;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = 0;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === BOM) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  let value = "";
  let ended = 2;
  let added = 0;

  // The rest of an unquoted field from `pos`, appended to `init`: a comma, a line break or the end of the
  // text ends it, and a CR not followed by LF is dropped, with stray_cr. Sets value/ended/added.
  function readUnquotedRest(init) {
    let start = pos;
    let acc = init;
    let kept = 0;
    while (true) {
      let i = pos;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === COMMA || c === LF || c === CR) break;
        i++;
      }
      if (i > start) {
        const piece = text.slice(start, i);
        acc = acc === "" ? piece : acc + piece;
        kept += i - start;
      }
      if (i >= n) {
        pos = n;
        value = acc;
        added = kept;
        ended = 2;
        return;
      }
      const c = text.charCodeAt(i);
      if (c === COMMA) {
        pos = i + 1;
        value = acc;
        added = kept;
        ended = 0;
        return;
      }
      if (c === LF) {
        pos = i + 1;
        line++;
        value = acc;
        added = kept;
        ended = 1;
        return;
      }
      if (text.charCodeAt(i + 1) === LF) {
        pos = i + 2;
        line++;
        value = acc;
        added = kept;
        ended = 1;
        return;
      }
      errors.push({ code: "stray_cr", line: recordLine, row: recordRow });
      pos = i + 1;
      start = pos;
    }
  }

  // A quoted field's text between two quotes: CRLF and a lone CR are each one LF, and each counts a line.
  function appendQuoted(chunk) {
    const len = chunk.length;
    let i = 0;
    while (i < len) {
      const c = chunk.charCodeAt(i);
      if (c === CR || c === LF) break;
      i++;
    }
    if (i === len) {
      value = value === "" ? chunk : value + chunk;
      return;
    }
    let out = "";
    let from = 0;
    while (i < len) {
      const c = chunk.charCodeAt(i);
      if (c === CR) {
        line++;
        if (i > from) out += chunk.slice(from, i);
        out += "\n";
        i += chunk.charCodeAt(i + 1) === LF ? 2 : 1;
        from = i;
      } else if (c === LF) {
        line++;
        if (i > from) out += chunk.slice(from, i);
        out += "\n";
        i++;
        from = i;
      } else {
        i++;
      }
    }
    if (from < len) out += chunk.slice(from, len);
    value += out;
  }

  // A quoted field whose opening quote is at `pos`: to the next quote that is not doubled, "" one quote.
  function readQuoted() {
    const openPos = pos;
    const openLine = line;
    pos++;
    let q = pos;
    let closed = false;
    value = "";
    while (true) {
      const idx = text.indexOf('"', q);
      if (idx < 0) break;
      if (idx > q) appendQuoted(text.slice(q, idx));
      if (text.charCodeAt(idx + 1) === QUOTE) {
        value += '"';
        q = idx + 2;
        continue;
      }
      pos = idx + 1;
      closed = true;
      break;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = openPos + 1;
      line = openLine;
      errors.push({ code: "unterminated_quote", line: recordLine, row: recordRow });
      readUnquotedRest('"');
      return;
    }
    if (pos >= n) {
      ended = 2;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === COMMA) {
      pos++;
      ended = 0;
      return;
    }
    if (c === LF) {
      pos++;
      line++;
      ended = 1;
      return;
    }
    if (c === CR && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line++;
      ended = 1;
      return;
    }
    // What follows the closing quote, up to the next comma or line break, is appended as it stands.
    readUnquotedRest(value);
    if (added > 0) errors.push({ code: "quote_junk", line: recordLine, row: recordRow });
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos++;
        line++;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = width > 0 ? new Array(width) : [];
    let count = 0;
    let quoted = false;
    do {
      if (text.charCodeAt(pos) === QUOTE) {
        quoted = true;
        readQuoted();
      } else {
        quoted = false;
        const from = pos;
        let i = pos;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === COMMA || c === LF || c === CR) break;
          i++;
        }
        if (i >= n) {
          value = text.slice(from, n);
          pos = n;
          ended = 2;
        } else {
          const c = text.charCodeAt(i);
          if (c === COMMA) {
            value = text.slice(from, i);
            pos = i + 1;
            ended = 0;
          } else if (c === LF) {
            value = text.slice(from, i);
            pos = i + 1;
            line++;
            ended = 1;
          } else if (text.charCodeAt(i + 1) === LF) {
            value = text.slice(from, i);
            pos = i + 2;
            line++;
            ended = 1;
          } else {
            // A stray CR: dropped, with stray_cr, and the field goes on after it.
            const prefix = text.slice(from, i);
            pos = i + 1;
            errors.push({ code: "stray_cr", line: recordLine, row: recordRow });
            readUnquotedRest(prefix);
          }
        }
      }
      if (count < fields.length) fields[count] = value;
      else fields.push(value);
      count++;
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (count === 1 && fields[0] === "" && !quoted) continue;

    if (width === 0) width = count;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (count < width) {
      errors.push({ code: "short_row", line: recordLine, row: recordRow, fields: count });
      for (let k = count; k < width; k++) fields[k] = "";
    } else if (count > width) {
      errors.push({ code: "long_row", line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
