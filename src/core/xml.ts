/**
 * A small, strict XML reader for providers that publish XML.
 *
 * It parses exactly what simple data documents use -- elements, attributes,
 * character data, CDATA sections, comments and processing instructions -- into a
 * plain element tree. It is deliberately not a general XML implementation:
 *
 * - A document type declaration is refused outright. Without DTD support there is
 *   no way to declare an entity, so entity-expansion and external-entity attacks
 *   have nothing to work with.
 * - Only the five predefined entities and numeric character references are
 *   decoded. Any other `&` sequence is a malformed document, not literal text.
 * - Input size and nesting depth are bounded, so a hostile or broken response
 *   cannot exhaust memory or the stack.
 *
 * Namespaces are not resolved. Element and attribute names keep the prefix they
 * were written with, which is enough for documents whose shape a provider fixes.
 */
import { ResponseValidationError } from "./errors.js";

/** One element of a parsed XML document. */
export type XmlElement = {
  /** Element name exactly as written, including any namespace prefix. */
  readonly name: string;
  /** Attribute values, entity-decoded and whitespace-normalized. */
  readonly attributes: Readonly<Record<string, string>>;
  /** Child elements in document order. */
  readonly children: readonly XmlElement[];
  /** Character data directly inside this element, entity-decoded and concatenated. */
  readonly text: string;
};

/** Options for {@link parseXml}. */
export type XmlParseOptions = {
  /** Provider named on the error raised for a malformed document. */
  provider?: string;
  /** Maximum accepted document length in characters. Defaults to 10 MiB. */
  maxLength?: number;
  /** Maximum element nesting depth. Defaults to 64. */
  maxDepth?: number;
};

type MutableElement = {
  name: string;
  attributes: Record<string, string>;
  children: MutableElement[];
  text: string;
};

const DEFAULT_MAX_LENGTH = 10 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 64;
const NAME_PATTERN = /[A-Za-z_:][\w.:-]*/y;
const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  apos: "'",
  quot: '"',
};

class XmlSyntaxError extends Error {}

function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&([^;&\s]*);?/g, (match, entity: string) => {
    if (!match.endsWith(";")) throw new XmlSyntaxError("contains an unterminated entity.");
    const named = PREDEFINED_ENTITIES[entity];
    if (named !== undefined) return named;
    const numeric = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(entity);
    if (numeric === null) throw new XmlSyntaxError(`uses the undeclared entity "&${entity};".`);
    const codePoint =
      numeric[1] === undefined
        ? Number.parseInt(numeric[2] ?? "", 10)
        : Number.parseInt(numeric[1], 16);
    if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw new XmlSyntaxError(`references the invalid character "&${entity};".`);
    }
    return String.fromCodePoint(codePoint);
  });
}

function readName(source: string, position: number): string | undefined {
  NAME_PATTERN.lastIndex = position;
  return NAME_PATTERN.exec(source)?.[0];
}

function skipWhitespace(source: string, position: number): number {
  let index = position;
  while (index < source.length && /\s/.test(source.charAt(index))) index += 1;
  return index;
}

function indexAfter(source: string, terminator: string, position: number, what: string): number {
  const end = source.indexOf(terminator, position);
  if (end === -1) throw new XmlSyntaxError(`contains an unterminated ${what}.`);
  return end + terminator.length;
}

function freeze(element: MutableElement): XmlElement {
  return {
    name: element.name,
    attributes: element.attributes,
    children: element.children.map(freeze),
    text: element.text,
  };
}

function parseDocument(source: string, maxDepth: number): XmlElement {
  const stack: MutableElement[] = [];
  let root: MutableElement | undefined;
  let position = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (position < source.length) {
    if (source.startsWith("<!--", position)) {
      position = indexAfter(source, "-->", position + 4, "comment");
      continue;
    }
    if (source.startsWith("<![CDATA[", position)) {
      const end = source.indexOf("]]>", position + 9);
      if (end === -1) throw new XmlSyntaxError("contains an unterminated CDATA section.");
      const current = stack.at(-1);
      if (current === undefined) throw new XmlSyntaxError("has character data outside the root.");
      current.text += source.slice(position + 9, end);
      position = end + 3;
      continue;
    }
    if (source.startsWith("<?", position)) {
      position = indexAfter(source, "?>", position + 2, "processing instruction");
      continue;
    }
    if (source.startsWith("<!", position)) {
      throw new XmlSyntaxError("declares a document type, which is not supported.");
    }
    if (source.startsWith("</", position)) {
      const name = readName(source, position + 2);
      if (name === undefined) throw new XmlSyntaxError("has a malformed closing tag.");
      const close = skipWhitespace(source, position + 2 + name.length);
      if (source.charAt(close) !== ">") throw new XmlSyntaxError("has a malformed closing tag.");
      const open = stack.pop();
      if (open?.name !== name) {
        throw new XmlSyntaxError(`closes <${name}> without a matching opening tag.`);
      }
      position = close + 1;
      continue;
    }
    if (source.charAt(position) === "<") {
      if (root !== undefined && stack.length === 0) {
        throw new XmlSyntaxError("has more than one root element.");
      }
      const name = readName(source, position + 1);
      if (name === undefined) throw new XmlSyntaxError("has a malformed opening tag.");
      const element: MutableElement = { name, attributes: {}, children: [], text: "" };
      let index = position + 1 + name.length;
      let selfClosing = false;
      for (;;) {
        const afterSpace = skipWhitespace(source, index);
        if (source.startsWith("/>", afterSpace)) {
          selfClosing = true;
          index = afterSpace + 2;
          break;
        }
        if (source.charAt(afterSpace) === ">") {
          index = afterSpace + 1;
          break;
        }
        if (afterSpace === index) throw new XmlSyntaxError(`has a malformed <${name}> tag.`);
        const attribute = readName(source, afterSpace);
        if (attribute === undefined) throw new XmlSyntaxError(`has a malformed <${name}> tag.`);
        const equals = skipWhitespace(source, afterSpace + attribute.length);
        if (source.charAt(equals) !== "=") {
          throw new XmlSyntaxError(`has an attribute without a value in <${name}>.`);
        }
        const valueStart = skipWhitespace(source, equals + 1);
        const quote = source.charAt(valueStart);
        if (quote !== '"' && quote !== "'") {
          throw new XmlSyntaxError(`has an unquoted attribute value in <${name}>.`);
        }
        const valueEnd = source.indexOf(quote, valueStart + 1);
        if (valueEnd === -1) throw new XmlSyntaxError("contains an unterminated attribute value.");
        const rawValue = source.slice(valueStart + 1, valueEnd);
        if (rawValue.includes("<")) {
          throw new XmlSyntaxError(`has a "<" inside an attribute value in <${name}>.`);
        }
        if (Object.hasOwn(element.attributes, attribute)) {
          throw new XmlSyntaxError(`repeats the attribute "${attribute}" in <${name}>.`);
        }
        element.attributes[attribute] = decodeEntities(rawValue.replace(/[\t\n\r]/g, " "));
        index = valueEnd + 1;
      }
      const parent = stack.at(-1);
      if (parent === undefined) root = element;
      else parent.children.push(element);
      if (!selfClosing) {
        if (stack.length >= maxDepth) {
          throw new XmlSyntaxError(`nests elements deeper than ${maxDepth} levels.`);
        }
        stack.push(element);
      }
      position = index;
      continue;
    }

    const next = source.indexOf("<", position);
    const end = next === -1 ? source.length : next;
    const text = source.slice(position, end);
    const current = stack.at(-1);
    if (current === undefined) {
      if (text.trim().length > 0) throw new XmlSyntaxError("has character data outside the root.");
    } else {
      current.text += decodeEntities(text);
    }
    position = end;
  }

  if (stack.length > 0) {
    throw new XmlSyntaxError(`ends before <${stack.at(-1)?.name ?? ""}> is closed.`);
  }
  if (root === undefined) throw new XmlSyntaxError("contains no root element.");
  return freeze(root);
}

/**
 * Parses an XML document into an element tree.
 *
 * Raises {@link ResponseValidationError} for anything that is not a well-formed
 * document within the configured bounds, naming `provider` when given, so a
 * malformed provider response is reported like any other invalid payload.
 */
export function parseXml(source: string, options: XmlParseOptions = {}): XmlElement {
  const provider = options.provider;
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const label = provider === undefined ? "XML document" : `${provider} XML response`;
  if (source.length > maxLength) {
    throw new ResponseValidationError(`The ${label} exceeds ${maxLength} characters.`, {
      ...(provider === undefined ? {} : { provider }),
    });
  }
  try {
    return parseDocument(source, options.maxDepth ?? DEFAULT_MAX_DEPTH);
  } catch (error) {
    if (!(error instanceof XmlSyntaxError)) throw error;
    throw new ResponseValidationError(`The ${label} is not well-formed: it ${error.message}`, {
      ...(provider === undefined ? {} : { provider }),
    });
  }
}

/** Returns the child elements with exactly the given name, in document order. */
export function xmlChildren(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}

/** Returns the first child element with exactly the given name. */
export function xmlChild(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((child) => child.name === name);
}
