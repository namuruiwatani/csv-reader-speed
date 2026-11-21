// Byte-level csv-reader, third cut: the case document's `text` is already a JSON string body, so its
// bytes are valid JSON content as they stand. This reads the CSV over those escaped bytes (\" is a quote,
// \n a line break, \r a CR) and copies field bytes straight into the answer — no unescaping, no escaping,
// no JSON.parse, no JSON.stringify, no object per field.
//
// answersFromCases answers null when the document is outside what it takes; main.ts then answers the whole
// run with solve.js, which is exact for every input.

const COMMA = 44;
const BACKSLASH = 92;
const ESC_N = 110;
const ESC_R = 114;
const ESC_Q = 34;
const ESC_U = 117;
const LBRACKET = 91;
const RBRACKET = 93;
const RBRACE = 125;

const LIT_LF = -1;
const LIT_QUOTE = -2;

const TEXT_MARK = Buffer.from('"text":"');
const HEADER_MARK = Buffer.from('","header":');

const KEY_COLUMNS = Buffer.from('{"columns":');
const KEY_ROWS = Buffer.from(',"rows":[');
const KEY_ERRORS = Buffer.from('],"errors":[');

export function findCases(raw) {
  const cases = [];
  let p = 0;
  for (;;) {
    const ti = raw.indexOf(TEXT_MARK, p);
    if (ti < 0) break;
    const s = ti + TEXT_MARK.length;
    const hi = raw.indexOf(HEADER_MARK, s);
    if (hi < 0) return null;
    const hv = hi + HEADER_MARK.length;
    const hb = raw[hv];
    if (hb !== 116 && hb !== 102) return null;
    cases.push({ s, e: hi, header: hb === 116 });
    p = hv + 5;
  }
  return cases.length > 0 ? cases : null;
}

// A field's content copied into out: short spans byte by byte, long ones with one copy.
function emitSegments(t, f, out, o) {
  const ss = f.ss;
  const se = f.se;
  for (let k = 0; k < ss.length; k++) {
    const s = ss[k];
    if (s === LIT_LF) {
      out[o++] = BACKSLASH;
      out[o++] = ESC_N;
      continue;
    }
    if (s === LIT_QUOTE) {
      out[o++] = BACKSLASH;
      out[o++] = ESC_Q;
      continue;
    }
    const e = se[k];
    const len = e - s;
    if (len <= 24) {
      for (let i = s; i < e; i++) out[o++] = t[i];
    } else {
      t.copy(out, o, s, e);
      o += len;
    }
  }
  return o;
}

function emitField(t, f, out, o) {
  out[o++] = ESC_Q;
  o = emitSegments(t, f, out, o);
  out[o++] = ESC_Q;
  return o;
}

const HEX = Buffer.from('0123456789abcdef');

function errJson(t, err, out, o, extraFields) {
  const head = Buffer.from(
    '{"code":"' + err.code + '","line":' + err.line + ',"row":' + (err.row === null ? 'null' : err.row)
  );
  head.copy(out, o);
  o += head.length;
  if (err.fields !== undefined) {
    const f = Buffer.from(',"fields":' + err.fields + '}');
    f.copy(out, o);
    return o + f.length;
  }
  if (err.extra !== undefined) {
    const pre = Buffer.from(',"extra":[');
    pre.copy(out, o);
    o += pre.length;
    for (let k = 0; k < extraFields.length; k++) {
      if (k) out[o++] = COMMA;
      o = emitField(t, extraFields[k], out, o);
    }
    out[o++] = RBRACKET;
    out[o++] = RBRACE;
    return o;
  }
  out[o++] = RBRACE;
  return o;
}

// Reads one field of the escaped CSV at pos into f. Sets f.ended (0 comma, 1 line break, 2 end), f.lineInc,
// f.quoted. A lone CR outside quotes is dropped with stray_cr; a quote that never closes is literal and the
// text after it is read again as unquoted.
function readField(t, n, pos, recordLine, rowNum, errors, f) {
  f.ss.length = 0;
  f.se.length = 0;
  f.lineInc = 0;
  f.quoted = false;

  if (t[pos] !== BACKSLASH || t[pos + 1] !== ESC_Q) {
    return readUnquoted(t, n, pos, recordLine, rowNum, errors, f);
  }

  f.quoted = true;
  const openPos = pos;
  let i = pos + 2;
  let segStart = i;
  let closed = false;
  let lines = 0;
  while (i < n) {
    const c = t[i];
    if (c !== BACKSLASH) {
      i++;
      continue;
    }
    const d = t[i + 1];
    if (d === ESC_Q) {
      if (t[i + 2] === BACKSLASH && t[i + 3] === ESC_Q) {
        if (i > segStart) {
          f.ss.push(segStart);
          f.se.push(i);
        }
        f.ss.push(LIT_QUOTE);
        f.se.push(0);
        i += 4;
        segStart = i;
        continue;
      }
      if (i > segStart) {
        f.ss.push(segStart);
        f.se.push(i);
      }
      i += 2;
      closed = true;
      break;
    }
    if (d === ESC_N) {
      lines++;
      i += 2;
      continue;
    }
    if (d === ESC_R) {
      if (i > segStart) {
        f.ss.push(segStart);
        f.se.push(i);
      }
      f.ss.push(LIT_LF);
      f.se.push(0);
      lines++;
      i += t[i + 2] === BACKSLASH && t[i + 3] === ESC_N ? 4 : 2;
      segStart = i;
      continue;
    }
    i += d === ESC_U ? 6 : 2;
  }
  if (!closed) {
    errors.push({ code: 'unterminated_quote', line: recordLine, row: rowNum });
    f.ss.length = 0;
    f.se.length = 0;
    f.ss.push(LIT_QUOTE);
    f.se.push(0);
    return readUnquoted(t, n, openPos + 2, recordLine, rowNum, errors, f);
  }
  f.lineInc = lines;
  if (i >= n) {
    f.ended = 2;
    return n;
  }
  const c = t[i];
  if (c === COMMA) {
    f.ended = 0;
    return i + 1;
  }
  if (c === BACKSLASH && t[i + 1] === ESC_N) {
    f.ended = 1;
    f.lineInc = lines + 1;
    return i + 2;
  }
  if (c === BACKSLASH && t[i + 1] === ESC_R && t[i + 2] === BACKSLASH && t[i + 3] === ESC_N) {
    f.ended = 1;
    f.lineInc = lines + 1;
    return i + 4;
  }
  const before = f.ss.length;
  const after = readUnquoted(t, n, i, recordLine, rowNum, errors, f);
  if (f.ss.length > before) errors.push({ code: 'quote_junk', line: recordLine, row: rowNum });
  f.lineInc = lines + f.lineInc;
  return after;
}

function readUnquoted(t, n, pos, recordLine, rowNum, errors, f) {
  let start = pos;
  let lines = 0;
  for (;;) {
    let i = pos;
    for (;;) {
      if (i >= n) break;
      const c = t[i];
      if (c === COMMA) break;
      if (c === BACKSLASH) {
        const d = t[i + 1];
        if (d === ESC_N || d === ESC_R) break;
        i += d === ESC_U ? 6 : 2;
        continue;
      }
      i++;
    }
    if (i > start) {
      f.ss.push(start);
      f.se.push(i);
    }
    if (i >= n) {
      f.ended = 2;
      f.lineInc = lines;
      return n;
    }
    const c = t[i];
    if (c === COMMA) {
      f.ended = 0;
      f.lineInc = lines;
      return i + 1;
    }
    if (t[i + 1] === ESC_N) {
      f.ended = 1;
      f.lineInc = lines + 1;
      return i + 2;
    }
    if (t[i + 2] === BACKSLASH && t[i + 3] === ESC_N) {
      f.ended = 1;
      f.lineInc = lines + 1;
      return i + 4;
    }
    errors.push({ code: 'stray_cr', line: recordLine, row: rowNum });
    i += 2;
    pos = i;
    start = i;
  }
}

function cloneSegs(f) {
  return { ss: f.ss.slice(), se: f.se.slice() };
}

function emitCase(t, n, header, out, startO) {
  const cap = out.length;
  const errors = [];
  let o = startO;
  let pos = 0;
  let line = 1;
  let width = 0;
  let sawHeader = false;
  let rowIndex = 0;

  if (n >= 3 && t[0] === 0xef && t[1] === 0xbb && t[2] === 0xbf) pos = 3;

  KEY_COLUMNS.copy(out, o);
  o += KEY_COLUMNS.length;

  let rowsOpen = false;
  const f = { ss: [], se: [], ended: 2, lineInc: 0, quoted: false };

  for (;;) {
    while (pos < n) {
      if (t[pos] === BACKSLASH && t[pos + 1] === ESC_N) {
        pos += 2;
        line++;
      } else if (
        t[pos] === BACKSLASH &&
        t[pos + 1] === ESC_R &&
        t[pos + 2] === BACKSLASH &&
        t[pos + 3] === ESC_N
      ) {
        pos += 4;
        line++;
      } else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const rowNumber = header && !sawHeader ? null : rowIndex;
    const isColumns = header && !sawHeader;

    if (isColumns) {
      // the header record is the columns array
      const columnsStart = o;
      out[o++] = LBRACKET;
      let count = 0;
      let ended;
      do {
        pos = readField(t, n, pos, recordLine, rowNumber, errors, f);
        line += f.lineInc;
        ended = f.ended;
        if (count) out[o++] = COMMA;
        o = emitField(t, f, out, o);
        count++;
        if (o > cap - 8192) return -1;
      } while (ended === 0);
      if (count === 1 && f.ss.length === 0 && !f.quoted) {
        // a line left with no characters is no record
        o = columnsStart;
        continue;
      }
      out[o++] = RBRACKET;
      width = count;
      sawHeader = true;
      KEY_ROWS.copy(out, o);
      o += KEY_ROWS.length;
      rowsOpen = true;
      continue;
    }

    if (!rowsOpen) {
      if (header) {
        out[o++] = LBRACKET;
        out[o++] = RBRACKET;
      } else {
        out[o++] = 110;
        out[o++] = 117;
        out[o++] = 108;
        out[o++] = 108;
      }
      KEY_ROWS.copy(out, o);
      o += KEY_ROWS.length;
      rowsOpen = true;
    }

    const rowStart = o;
    if (rowIndex > 0) out[o++] = COMMA;
    out[o++] = LBRACKET;
    let count = 0;
    let ended;
    let extra = null;
    do {
      pos = readField(t, n, pos, recordLine, rowNumber, errors, f);
      line += f.lineInc;
      ended = f.ended;
      if (width === 0 || count < width) {
        if (count) out[o++] = COMMA;
        o = emitField(t, f, out, o);
      } else {
        if (!extra) extra = [];
        extra.push(cloneSegs(f));
      }
      count++;
      if (o > cap - 8192) return -1;
    } while (ended === 0);

    if (count === 1 && !extra && f.ss.length === 0 && !f.quoted) {
      // a line left with no characters is no record
      o = rowStart;
      continue;
    }

    if (width === 0) width = count;
    for (let k = count; k < width; k++) {
      if (k) out[o++] = COMMA;
      out[o++] = ESC_Q;
      out[o++] = ESC_Q;
    }
    out[o++] = RBRACKET;
    if (count < width) errors.push({ code: 'short_row', line: recordLine, row: rowIndex, fields: count });
    else if (count > width) errors.push({ code: 'long_row', line: recordLine, row: rowIndex, extra: extra });
    rowIndex++;
  }

  if (!rowsOpen) {
    if (header) {
      out[o++] = LBRACKET;
      out[o++] = RBRACKET;
    } else {
      out[o++] = 110;
      out[o++] = 117;
      out[o++] = 108;
      out[o++] = 108;
    }
    KEY_ROWS.copy(out, o);
    o += KEY_ROWS.length;
  }

  KEY_ERRORS.copy(out, o);
  o += KEY_ERRORS.length;
  for (let k = 0; k < errors.length; k++) {
    if (k) out[o++] = COMMA;
    o = errJson(t, errors[k], out, o, errors[k].extra);
    if (o > cap - 8192) return -1;
  }
  out[o++] = RBRACKET;
  out[o++] = RBRACE;
  return o;
}

export function answersFromCases(raw) {
  const cases = findCases(raw);
  if (!cases) return null;
  const out = Buffer.allocUnsafe(raw.length + (raw.length >> 2) + 1048576);
  let o = 0;
  out[o++] = 91;
  for (let k = 0; k < cases.length; k++) {
    const c = cases[k];
    if (k) out[o++] = 44;
    const t = raw.subarray(c.s, c.e);
    o = emitCase(t, t.length, c.header, out, o);
    if (o < 0) return null;
  }
  out[o++] = 93;
  return out.subarray(0, o);
}
