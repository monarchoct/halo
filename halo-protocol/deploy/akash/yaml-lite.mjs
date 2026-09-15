// Minimal YAML emitter/parser for the exact plain-object subset SDL documents use:
// nested block mappings, block sequences of scalars, and block sequences of mappings.
// No anchors, tags, multiline scalars or flow collections. Not a general-purpose YAML
// library; it only needs to invert what emitYaml itself produces, for round-trip tests.

const BARE = /^[A-Za-z][A-Za-z0-9-]*$/;

function scalar(value) {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Unsupported non-finite YAML number'); return String(value); }
  const text = String(value);
  return BARE.test(text) ? text : JSON.stringify(text);
}

function emitValue(value, indent) {
  if (Array.isArray(value)) {
    if (value.length === 0) return ' []\n';
    let out = '\n';
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const entries = Object.entries(item);
        if (entries.length === 0) throw new Error('Cannot emit an empty mapping inside a sequence');
        out += `${' '.repeat(indent)}- `;
        entries.forEach(([key, entryValue], index) => {
          out += `${index === 0 ? '' : ' '.repeat(indent + 2)}${key}:${emitValue(entryValue, indent + 4)}`;
        });
      } else out += `${' '.repeat(indent)}- ${scalar(item)}\n`;
    }
    return out;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return ' {}\n';
    let out = '\n';
    for (const [key, entryValue] of entries) out += `${' '.repeat(indent)}${key}:${emitValue(entryValue, indent + 2)}`;
    return out;
  }
  return ` ${scalar(value)}\n`;
}

/** Serialize a plain object into block-style YAML. Every string is safely quoted unless it is a bare identifier. */
export function emitYaml(document) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) throw new Error('YAML document root must be a mapping');
  let out = '';
  for (const [key, value] of Object.entries(document)) out += `${key}:${emitValue(value, 2)}`;
  return out;
}

function findColon(text) {
  // The colon that separates a mapping key from its value: outside quotes, followed by end-of-line or a space.
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i - 1] !== '\\') inQuotes = !inQuotes;
    else if (ch === ':' && !inQuotes && (i === text.length - 1 || text[i + 1] === ' ')) return i;
  }
  return -1;
}

function parseScalar(text) {
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^"(?:[^"\\]|\\.)*"$/.test(text)) return JSON.parse(text);
  if (/^-?\d+$/.test(text)) return parseInt(text, 10);
  if (/^-?\d+\.\d+$/.test(text)) return parseFloat(text);
  return text;
}

function tokenize(text) {
  const tokens = [];
  for (const raw of text.split('\n')) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    let indent = raw.length - raw.trimStart().length;
    let content = raw.trim();
    if (raw.slice(0, indent).includes('\t')) throw new Error('Tabs are not permitted in generated YAML indentation');
    while (content.startsWith('- ') || content === '-') {
      tokens.push({ indent, seqItem: true });
      indent += 2;
      content = content === '-' ? '' : content.slice(2);
      if (content === '') { content = null; break; }
    }
    if (content !== null) tokens.push({ indent, text: content });
  }
  return tokens;
}

function parseBlock(tokens, i, indent) {
  if (i >= tokens.length || tokens[i].indent < indent) return [undefined, i];
  if (tokens[i].seqItem) {
    const array = [];
    while (i < tokens.length && tokens[i].indent === indent && tokens[i].seqItem) {
      i++;
      const child = tokens[i];
      // A plain scalar item (no nested "key:" line) versus a mapping/sequence item.
      if (child && child.indent === indent + 2 && !child.seqItem && findColon(child.text) < 0) { array.push(parseScalar(child.text)); i++; }
      else { const [value, next] = parseBlock(tokens, i, indent + 2); array.push(value); i = next; }
    }
    return [array, i];
  }
  const object = {};
  while (i < tokens.length && tokens[i].indent === indent && !tokens[i].seqItem) {
    const line = tokens[i].text;
    const colon = findColon(line);
    if (colon < 0) throw new Error(`Malformed YAML mapping line: ${line}`);
    const key = line.slice(0, colon).trim();
    const valueText = line.slice(colon + 1).trim();
    i++;
    if (valueText === '') { const [child, next] = parseBlock(tokens, i, indent + 2); object[key] = child; i = next; }
    else object[key] = parseScalar(valueText);
  }
  return [object, i];
}

/** Parse the exact subset of YAML that emitYaml produces. Throws on anything else. */
export function parseYaml(text) {
  const tokens = tokenize(text);
  const [document, next] = parseBlock(tokens, 0, 0);
  if (next !== tokens.length) throw new Error('Trailing unparsed YAML content');
  return document;
}
