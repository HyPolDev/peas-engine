import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { Parser } from "htmlparser2";

import { type EventDraft, validateEventDraft } from "../../../core/event.js";
import { canonicalHash } from "../../../core/hash.js";
import { canonicalJson, type JsonValue } from "../../../core/json.js";
import {
  ProviderNormalizerInputError,
  ProviderNormalizerInputLimitError,
  snapshotExactNormalizerInput,
  snapshotNormalizerBytes,
} from "../../normalizer-input.js";
import {
  NVIDIA_IR_LIMITS,
  NVIDIA_IR_PROVIDER,
  NVIDIA_IR_SOURCE,
  NVIDIA_ISSUER_CIK,
  NVIDIA_SYMBOL,
  NvidiaContractError,
  type AllowedTagV1,
  type NvidiaIrLimitKind,
  type NvidiaIrReasonCode,
  type NvidiaNormalizationResult,
  type NvidiaNormalizationTranscript,
  type NvidiaRecordedCandidateV1,
  type NvidiaRecordedInput,
  type NvidiaReleaseVisibleProjectionV1,
  type NvidiaRssItemProjectionV1,
  type ParsedRssTimeV1,
  type SemanticHtmlTokenV1,
} from "./contracts.js";

type Node = { name: string; attributes: Record<string, string>; children: (Node | string)[] };
type ParseKind = "xml" | "html";
type ParseOptions = Readonly<{ rssChunkSize?: number; htmlChunkSize?: number }>;
type DetachedParseOptions = Readonly<{
  rssChunkSize: number | undefined;
  htmlChunkSize: number | undefined;
}>;

const ASCII_EDGE = /^[\t\n\r ]+|[\t\n\r ]+$/gu;
const ASCII_RUN = /[\t\n\f\r ]+/gu;
const URL_TOKEN = /\bhttps?:\/\/[^\s<>"'`]+/giu;
const ALLOWED = new Set<AllowedTagV1>([
  "article",
  "section",
  "div",
  "h1",
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "strong",
  "em",
  "blockquote",
  "br",
]);
const DROPPED = new Set([
  "script",
  "style",
  "template",
  "audio",
  "video",
  "svg",
  "canvas",
  "picture",
  "img",
  "iframe",
  "object",
  "embed",
]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const UNAVAILABLE_ARTIFACT_HASH = "0".repeat(64);

function snapshotNvidiaChunkSize(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > NVIDIA_IR_LIMITS.memberBytes
  ) {
    throw new ProviderNormalizerInputError();
  }
  return value;
}

function snapshotNvidiaParseOptions(value: unknown): DetachedParseOptions {
  const options = snapshotExactNormalizerInput(value, [], ["rssChunkSize", "htmlChunkSize"]);
  return Object.freeze({
    rssChunkSize: snapshotNvidiaChunkSize(options["rssChunkSize"]),
    htmlChunkSize: snapshotNvidiaChunkSize(options["htmlChunkSize"]),
  });
}

function snapshotNvidiaNormalizerInput(input: unknown): Readonly<{
  rssBytes: Uint8Array;
  releaseHtmlBytes: Uint8Array;
  selectionKey: string;
}> {
  const outer = snapshotExactNormalizerInput(input, [
    "rssBytes",
    "releaseHtmlBytes",
    "selectionKey",
  ]);
  if (typeof outer["selectionKey"] !== "string") throw new ProviderNormalizerInputError();
  return Object.freeze({
    rssBytes: snapshotNormalizerBytes(outer["rssBytes"], NVIDIA_IR_LIMITS.memberBytes),
    releaseHtmlBytes: snapshotNormalizerBytes(
      outer["releaseHtmlBytes"],
      NVIDIA_IR_LIMITS.memberBytes,
    ),
    selectionKey: parseNvidiaReference(outer["selectionKey"]),
  });
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function trim(value: string): string {
  return value.replace(ASCII_EDGE, "");
}

function collapse(value: string): string {
  return trim(value.replace(ASCII_RUN, " "));
}

function semanticText(value: string): string {
  return collapse(value.replace(URL_TOKEN, " "));
}

function decode(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    if (text.startsWith("\uFEFF") || text.includes("\u0000")) throw new Error("invalid");
    return text;
  } catch {
    throw new NvidiaContractError("ir.unsupported-encoding");
  }
}

function parseTree(
  source: string,
  kind: ParseKind,
  chunkSize: number | undefined,
): (Node | string)[] {
  const roots: (Node | string)[] = [];
  const stack: Node[] = [];
  const depthLimit = kind === "xml" ? NVIDIA_IR_LIMITS.xmlDepth : NVIDIA_IR_LIMITS.htmlDepth;
  const attributeLimit =
    kind === "xml" ? NVIDIA_IR_LIMITS.xmlAttributes : NVIDIA_IR_LIMITS.htmlAttributes;
  const kinds: readonly NvidiaIrLimitKind[] =
    kind === "xml"
      ? ["xml-tokens", "xml-depth", "xml-attributes"]
      : ["html-tokens", "html-depth", "html-attributes"];
  let tokens = 0;
  let malformed = false;
  const bump = (): void => {
    tokens += 1;
    assertNvidiaDeclaredLimit(kinds[0] as NvidiaDeclaredLimitKind, tokens);
  };
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        bump();
        if (stack.length + 1 > depthLimit)
          throw new NvidiaContractError("ir.parser-limit-exceeded", kinds[1]);
        if (Object.keys(attributes).length > attributeLimit)
          throw new NvidiaContractError("ir.parser-limit-exceeded", kinds[2]);
        const node: Node = { name, attributes, children: [] };
        const parent = stack.at(-1);
        if (parent === undefined) roots.push(node);
        else parent.children.push(node);
        stack.push(node);
      },
      ontext(text) {
        bump();
        const parent = stack.at(-1);
        const target = parent?.children ?? roots;
        const previous = target.at(-1);
        if (typeof previous === "string") target[target.length - 1] = previous + text;
        else target.push(text);
      },
      onclosetag() {
        bump();
        if (stack.pop() === undefined) malformed = true;
      },
      oncomment() {
        bump();
      },
      onprocessinginstruction() {
        malformed = true;
      },
      onerror() {
        malformed = true;
      },
    },
    kind === "xml"
      ? {
          xmlMode: true,
          decodeEntities: true,
          lowerCaseTags: false,
          lowerCaseAttributeNames: false,
          recognizeSelfClosing: true,
        }
      : {
          xmlMode: false,
          decodeEntities: true,
          lowerCaseTags: true,
          lowerCaseAttributeNames: true,
          recognizeSelfClosing: false,
        },
  );
  const size =
    Number.isSafeInteger(chunkSize) && (chunkSize ?? 0) > 0
      ? (chunkSize as number)
      : Math.max(1, source.length);
  for (let offset = 0; offset < source.length; offset += size)
    parser.write(source.slice(offset, offset + size));
  parser.end();
  if (malformed || stack.length !== 0)
    throw new NvidiaContractError(kind === "xml" ? "ir.feed-malformed" : "ir.release-malformed");
  return roots;
}

function elements(node: Node): Node[] {
  return node.children.filter((child): child is Node => typeof child !== "string");
}

function whitespaceOnly(node: Node, reason: NvidiaIrReasonCode): void {
  if (node.children.some((child) => typeof child === "string" && trim(child) !== ""))
    throw new NvidiaContractError(reason);
}

function scalar(node: Node, reason: NvidiaIrReasonCode): string {
  if (
    Object.keys(node.attributes).length !== 0 ||
    node.children.some((child) => typeof child !== "string")
  )
    throw new NvidiaContractError(reason);
  return trim(node.children.join(""));
}

function unique(
  children: readonly Node[],
  name: string,
  required: boolean,
  reason: NvidiaIrReasonCode,
): Node | null {
  const matches = children.filter((child) => child.name === name);
  if (matches.length > 1 || (required && matches.length !== 1))
    throw new NvidiaContractError(reason);
  return matches[0] ?? null;
}

function semanticTokens(input: readonly (Node | string)[]): SemanticHtmlTokenV1[] {
  const output: SemanticHtmlTokenV1[] = [];
  let textBytes = 0;
  const visit = (entry: Node | string, dropped: boolean): void => {
    if (typeof entry === "string") {
      if (dropped) return;
      const text = semanticText(entry);
      if (text === "") return;
      textBytes += Buffer.byteLength(text, "utf8");
      assertNvidiaDeclaredLimit("extracted-text-bytes", textBytes);
      const previous = output.at(-1);
      if (previous?.kind === "text")
        output[output.length - 1] = {
          kind: "text",
          text: semanticText(`${previous.text} ${text}`),
        };
      else output.push({ kind: "text", text });
      return;
    }
    if (dropped || DROPPED.has(entry.name)) return;
    const retained = ALLOWED.has(entry.name as AllowedTagV1);
    if (retained) output.push({ kind: "start", name: entry.name as AllowedTagV1 });
    for (const child of entry.children) visit(child, false);
    if (retained) output.push({ kind: "end", name: entry.name as AllowedTagV1 });
  };
  for (const entry of input) visit(entry, false);
  return output;
}

function visibleText(node: Node): string {
  return collapse(
    semanticTokens(node.children)
      .filter(
        (token): token is Extract<SemanticHtmlTokenV1, { kind: "text" }> => token.kind === "text",
      )
      .map((token) => token.text)
      .join(" "),
  );
}

function descendants(node: Node, includeRoot = false): Node[] {
  const result: Node[] = [];
  const visit = (current: Node): void => {
    result.push(current);
    for (const child of elements(current)) visit(child);
  };
  if (includeRoot) visit(node);
  else for (const child of elements(node)) visit(child);
  return result;
}

function hasClass(node: Node, className: string): boolean {
  return (node.attributes["class"] ?? "").split(ASCII_RUN).includes(className);
}

export function parseNvidiaReference(value: string): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > NVIDIA_IR_LIMITS.referenceBytes ||
    !/^[!-~]+$/u.test(value) ||
    value.includes("\\") ||
    value.includes("%")
  )
    throw new NvidiaContractError("ir.link-invalid");
  const match =
    /^https:\/\/nvidianews\.nvidia\.com\/news\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\?([^#]*))?(?:#([^#]*))?$/u.exec(
      value,
    );
  if (match === null || Buffer.byteLength(match[1] ?? "", "ascii") > 256)
    throw new NvidiaContractError("ir.link-invalid");
  return `https://nvidianews.nvidia.com/news/${match[1]}`;
}

function parseTime(value: string): ParsedRssTimeV1 {
  const match =
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), ([0-9]{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/u.exec(
      value,
    );
  if (match === null) throw new NvidiaContractError("ir.timestamp-invalid");
  const year = Number(match[4]);
  const month = MONTHS.indexOf(match[3] ?? "");
  const day = Number(match[2]);
  const hour = Number(match[5]);
  const minute = Number(match[6]);
  const second = Number(match[7]);
  if (year < 1970 || month < 0 || hour > 23 || minute > 59 || second > 59)
    throw new NvidiaContractError("ir.timestamp-invalid");
  const epochMs = Date.UTC(year, month, day, hour, minute, second);
  const date = new Date(epochMs);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    WEEKDAYS[date.getUTCDay()] !== match[1]
  )
    throw new NvidiaContractError("ir.timestamp-invalid");
  return { originalTimestamp: value, epochMs };
}

function unwrapContent(value: string): string {
  const start = "<![CDATA[";
  const end = "]] >".replace(" ", "");
  const hasStart = value.startsWith(start);
  const hasEnd = value.endsWith(end);
  if (hasStart !== hasEnd) throw new NvidiaContractError("ir.item-invalid");
  if (!hasStart) return value;
  const inner = value.slice(start.length, -end.length);
  if (inner.includes(start) || inner.includes(end))
    throw new NvidiaContractError("ir.item-invalid");
  return inner;
}

type SelectedRss = Readonly<{ selectionKey: string; projection: NvidiaRssItemProjectionV1 }>;

function parseRss(
  source: string,
  selectionKey: string,
  chunkSize: number | undefined,
): SelectedRss {
  const roots = parseTree(source, "xml", chunkSize);
  const rootElements = roots.filter((entry): entry is Node => typeof entry !== "string");
  if (
    roots.some((entry) => typeof entry === "string" && trim(entry) !== "") ||
    rootElements.length !== 1
  )
    throw new NvidiaContractError("ir.feed-malformed");
  const rss = rootElements[0];
  if (rss?.name !== "rss") throw new NvidiaContractError("ir.feed-malformed");
  const rootKeys = Object.keys(rss.attributes).sort();
  if (
    rss.attributes["version"] !== "2.0" ||
    rootKeys.some((key) => key !== "version" && key !== "xmlns:media") ||
    (rss.attributes["xmlns:media"] !== undefined &&
      rss.attributes["xmlns:media"] !== "http://search.yahoo.com/mrss/")
  )
    throw new NvidiaContractError("ir.feed-malformed");
  whitespaceOnly(rss, "ir.feed-malformed");
  const rootChildren = elements(rss);
  if (rootChildren.length !== 1 || rootChildren[0]?.name !== "channel")
    throw new NvidiaContractError("ir.feed-malformed");
  const channel = rootChildren[0];
  if (Object.keys(channel.attributes).length !== 0)
    throw new NvidiaContractError("ir.feed-malformed");
  whitespaceOnly(channel, "ir.feed-malformed");
  const channelChildren = elements(channel);
  const channelAllowed = new Set([
    "title",
    "link",
    "description",
    "language",
    "pubDate",
    "lastBuildDate",
    "generator",
    "item",
  ]);
  if (channelChildren.some((child) => !channelAllowed.has(child.name)))
    throw new NvidiaContractError("ir.feed-malformed");
  for (const name of ["title", "link", "description"])
    scalar(unique(channelChildren, name, true, "ir.feed-malformed") as Node, "ir.feed-malformed");
  for (const name of ["language", "pubDate", "lastBuildDate", "generator"]) {
    const value = unique(channelChildren, name, false, "ir.feed-malformed");
    if (value !== null) scalar(value, "ir.feed-malformed");
  }
  const items = channelChildren.filter((child) => child.name === "item");
  if (items.length === 0) throw new NvidiaContractError("ir.feed-malformed");
  if (items.length > NVIDIA_IR_LIMITS.items)
    throw new NvidiaContractError("ir.item-limit-exceeded");
  const selected: SelectedRss[] = [];
  const families = new Map<string, string>();
  const selectionKeys = new Map<string, string>();
  for (const item of items) {
    const parsed = parseRssItem(item, rss.attributes["xmlns:media"] !== undefined, chunkSize);
    assertNvidiaDeclaredLimit(
      "projection-bytes",
      Buffer.byteLength(canonicalJson(parsed.projection as unknown as JsonValue), "utf8"),
    );
    const projectionHash = canonicalHash(
      "peas/nvidia-ir-rss-item-projection/v1",
      parsed.projection as unknown as JsonValue,
    );
    const priorSelection = selectionKeys.get(parsed.selectionKey);
    if (priorSelection !== undefined && priorSelection !== projectionHash)
      throw new NvidiaContractError("ir.duplicate-guid-conflict");
    selectionKeys.set(parsed.selectionKey, projectionHash);
    const family = canonicalJson({
      title: parsed.projection.title,
      itemPubDateOriginal: parsed.projection.pubDate?.originalTimestamp ?? null,
    });
    const prior = families.get(family);
    if (prior !== undefined && prior !== projectionHash)
      throw new NvidiaContractError("ir.record-family-ambiguous");
    families.set(family, projectionHash);
    if (parsed.selectionKey === selectionKey) selected.push(parsed);
  }
  if (selected.length === 0) throw new NvidiaContractError("ir.item-invalid");
  const hashes = new Set(
    selected.map((entry) =>
      canonicalHash(
        "peas/nvidia-ir-rss-item-projection/v1",
        entry.projection as unknown as JsonValue,
      ),
    ),
  );
  if (hashes.size > 1) throw new NvidiaContractError("ir.duplicate-guid-conflict");
  return selected[0] as SelectedRss;
}

function parseRssItem(item: Node, mediaBound: boolean, chunkSize: number | undefined): SelectedRss {
  if (Object.keys(item.attributes).length !== 0) throw new NvidiaContractError("ir.item-invalid");
  whitespaceOnly(item, "ir.item-invalid");
  const children = elements(item);
  const allowed = new Set([
    "title",
    "link",
    "guid",
    "contentType",
    "content",
    "categories",
    "subtitle",
    "description",
    "pubDate",
    "modDate",
    "relatedPages",
    "enclosure",
    "media:content",
  ]);
  if (children.some((child) => !allowed.has(child.name)))
    throw new NvidiaContractError("ir.item-invalid");
  const required = new Map<string, Node>();
  for (const name of ["title", "link", "guid", "contentType", "content", "categories"])
    required.set(name, unique(children, name, true, "ir.item-invalid") as Node);
  for (const name of [
    "subtitle",
    "description",
    "pubDate",
    "modDate",
    "relatedPages",
    "enclosure",
    "media:content",
  ])
    unique(children, name, false, "ir.item-invalid");
  const media = unique(children, "media:content", false, "ir.item-invalid");
  if (media !== null && !mediaBound) throw new NvidiaContractError("ir.item-invalid");
  const title = scalar(required.get("title") as Node, "ir.item-invalid");
  if (title === "" || Buffer.byteLength(title, "utf8") > NVIDIA_IR_LIMITS.titleBytes)
    throw new NvidiaContractError("ir.item-invalid");
  const link = parseNvidiaReference(scalar(required.get("link") as Node, "ir.item-invalid"));
  const guidNode = required.get("guid") as Node;
  if (
    Object.keys(guidNode.attributes).length !== 1 ||
    guidNode.attributes["isPermaLink"] !== "true"
  )
    throw new NvidiaContractError("ir.item-invalid");
  const guid = parseNvidiaReference(
    trim(guidNode.children.filter((child): child is string => typeof child === "string").join("")),
  );
  if (guidNode.children.some((child) => typeof child !== "string") || guid !== link)
    throw new NvidiaContractError("ir.canonical-conflict");
  if (scalar(required.get("contentType") as Node, "ir.item-invalid") !== "releases")
    throw new NvidiaContractError("ir.item-invalid");
  const categoriesNode = required.get("categories") as Node;
  if (Object.keys(categoriesNode.attributes).length !== 0)
    throw new NvidiaContractError("ir.item-invalid");
  whitespaceOnly(categoriesNode, "ir.item-invalid");
  const categoryNodes = elements(categoriesNode);
  if (
    categoryNodes.length === 0 ||
    categoryNodes.length > NVIDIA_IR_LIMITS.categories ||
    categoryNodes.some((node) => node.name !== "category")
  )
    throw new NvidiaContractError("ir.parser-limit-exceeded", "categories");
  const categories = categoryNodes.map((node) => scalar(node, "ir.item-invalid"));
  if (
    categories.some((value) => value === "") ||
    new Set(categories).size !== categories.length ||
    !categories.includes("Press Releases")
  )
    throw new NvidiaContractError("ir.item-invalid");
  categories.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const optionalScalar = (name: string): string | null => {
    const node = unique(children, name, false, "ir.item-invalid");
    return node === null ? null : scalar(node, "ir.item-invalid");
  };
  const subtitle = optionalScalar("subtitle");
  if (subtitle !== null && Buffer.byteLength(subtitle, "utf8") > NVIDIA_IR_LIMITS.subtitleBytes)
    throw new NvidiaContractError("ir.item-invalid");
  const content = unwrapContent(scalar(required.get("content") as Node, "ir.item-invalid"));
  const contentTokens = semanticTokens(parseTree(content, "html", chunkSize));
  const pubDateValue = optionalScalar("pubDate");
  const modDateValue = optionalScalar("modDate");
  return {
    selectionKey: link,
    projection: {
      projectionVersion: 1,
      dialect: "peas-nvidia-newsroom-rss-synthetic-v1",
      issuerCik: NVIDIA_ISSUER_CIK,
      title,
      subtitle: subtitle === null ? null : semanticText(subtitle) || null,
      contentType: "releases",
      contentTokens,
      description: semanticText(optionalScalar("description") ?? "") || null,
      categories,
      pubDate: pubDateValue === null ? null : parseTime(pubDateValue),
      modDate: modDateValue === null ? null : parseTime(modDateValue),
    },
  };
}

function parseRelease(
  source: string,
  selectionKey: string,
  expectedTitle: string,
  chunkSize: number | undefined,
): NvidiaReleaseVisibleProjectionV1 {
  const roots = parseTree(source, "html", chunkSize);
  const all: Node[] = [];
  for (const root of roots) if (typeof root !== "string") all.push(...descendants(root, true));
  const canonicals = all.filter(
    (node) =>
      node.name === "link" &&
      (node.attributes["rel"] ?? "")
        .split(ASCII_RUN)
        .filter(Boolean)
        .filter((token) => token === "canonical").length === 1 &&
      node.attributes["href"] !== undefined,
  );
  const ogUrls = all.filter(
    (node) =>
      node.name === "meta" &&
      node.attributes["property"] === "og:url" &&
      node.attributes["content"] !== undefined,
  );
  if (canonicals.length !== 1 || ogUrls.length !== 1)
    throw new NvidiaContractError("ir.canonical-conflict");
  try {
    if (
      parseNvidiaReference(canonicals[0]?.attributes["href"] ?? "") !== selectionKey ||
      parseNvidiaReference(ogUrls[0]?.attributes["content"] ?? "") !== selectionKey
    )
      throw new NvidiaContractError("ir.canonical-conflict");
  } catch (error) {
    if (error instanceof NvidiaContractError && error.reasonCode === "ir.link-invalid")
      throw new NvidiaContractError("ir.canonical-conflict");
    throw error;
  }
  const articles = all.filter((node) => hasClass(node, "article"));
  if (articles.length !== 1) throw new NvidiaContractError("ir.release-malformed");
  const inside = descendants(articles[0] as Node, true);
  const select = (className: string, required: boolean): Node | null => {
    const matches = inside.filter((node) => hasClass(node, className));
    if (matches.length > 1 || (required && matches.length !== 1))
      throw new NvidiaContractError("ir.release-malformed");
    return matches[0] ?? null;
  };
  const titleNode = select("article-title", true) as Node;
  if (titleNode.name !== "h1") throw new NvidiaContractError("ir.release-malformed");
  const title = visibleText(titleNode);
  if (title !== expectedTitle) throw new NvidiaContractError("ir.release-title-conflict");
  const subtitleNode = select("article-subtitle", false);
  const dateNode = select("article-date", false);
  const bodyNode = select("article-body", true) as Node;
  const projection: NvidiaReleaseVisibleProjectionV1 = {
    projectionVersion: 1,
    dialect: "peas-nvidia-newsroom-release-visible-synthetic-v1",
    issuerCik: NVIDIA_ISSUER_CIK,
    title,
    subtitle: subtitleNode === null ? null : visibleText(subtitleNode),
    dateText: dateNode === null ? null : visibleText(dateNode),
    bodyTokens: semanticTokens(bodyNode.children),
  };
  assertNvidiaDeclaredLimit(
    "projection-bytes",
    Buffer.byteLength(canonicalJson(projection as unknown as JsonValue), "utf8"),
  );
  return projection;
}

function fiscalPeriod(title: string): string | null {
  const quarter =
    /^NVIDIA Announces Financial Results for (First|Second|Third) Quarter Fiscal (20[0-9]{2}|[3-9][0-9]{3})$/u.exec(
      title,
    );
  if (quarter !== null)
    return `${quarter[2]}-${({ First: "Q1", Second: "Q2", Third: "Q3" } as const)[quarter[1] as "First" | "Second" | "Third"]}`;
  const annual =
    /^NVIDIA Announces Financial Results for Fourth Quarter and Fiscal (20[0-9]{2}|[3-9][0-9]{3})$/u.exec(
      title,
    );
  return annual === null ? null : `${annual[1]}-FY`;
}

function transcript(
  status: "emitted" | "ignored" | "quarantined",
  reasonCode: NvidiaIrReasonCode | null,
  limitKind: NvidiaIrLimitKind | null,
  rssArtifactHash: string,
  releaseHtmlArtifactHash: string,
  hashes: Partial<NvidiaNormalizationTranscript> = {},
): NvidiaNormalizationTranscript {
  return {
    status,
    reasonCode,
    limitKind,
    rssArtifactHash,
    releaseHtmlArtifactHash,
    rssItemProjectionHash: hashes.rssItemProjectionHash ?? null,
    releaseVisibleProjectionHash: hashes.releaseVisibleProjectionHash ?? null,
    selectedProjectionHash: hashes.selectedProjectionHash ?? null,
    candidateHash: hashes.candidateHash ?? null,
    eventDraftHash: hashes.eventDraftHash ?? null,
  };
}

export function assertNvidiaRecordedMemberBounds(
  rssBytes: Uint8Array,
  releaseHtmlBytes: Uint8Array,
): void {
  assertNvidiaDeclaredLimit("member-bytes", rssBytes.byteLength);
  assertNvidiaDeclaredLimit("member-bytes", releaseHtmlBytes.byteLength);
  assertNvidiaDeclaredLimit("bundle-bytes", rssBytes.byteLength + releaseHtmlBytes.byteLength);
}

export type NvidiaDeclaredLimitKind =
  | NvidiaIrLimitKind
  | "member-bytes"
  | "bundle-bytes"
  | "projection-bytes"
  | "transcript-bytes";

/** Shared exact boundary gate used by parsers, loaders, and generated one-over tests. */
export function assertNvidiaDeclaredLimit(kind: NvidiaDeclaredLimitKind, value: number): void {
  const limits: Readonly<Record<NvidiaDeclaredLimitKind, number>> = {
    "xml-tokens": NVIDIA_IR_LIMITS.xmlTokens,
    "xml-depth": NVIDIA_IR_LIMITS.xmlDepth,
    "xml-attributes": NVIDIA_IR_LIMITS.xmlAttributes,
    "html-tokens": NVIDIA_IR_LIMITS.htmlTokens,
    "html-depth": NVIDIA_IR_LIMITS.htmlDepth,
    "html-attributes": NVIDIA_IR_LIMITS.htmlAttributes,
    "extracted-text-bytes": NVIDIA_IR_LIMITS.extractedTextBytes,
    categories: NVIDIA_IR_LIMITS.categories,
    "member-bytes": NVIDIA_IR_LIMITS.memberBytes,
    "bundle-bytes": NVIDIA_IR_LIMITS.bundleBytes,
    "projection-bytes": NVIDIA_IR_LIMITS.projectionBytes,
    "transcript-bytes": NVIDIA_IR_LIMITS.transcriptBytes,
  };
  if (!Number.isSafeInteger(value) || value < 0 || value > limits[kind]) {
    if (kind === "member-bytes") throw new NvidiaContractError("ir.member-limit-exceeded");
    if (kind === "bundle-bytes") throw new NvidiaContractError("ir.bundle-byte-limit-exceeded");
    throw new NvidiaContractError(
      "ir.parser-limit-exceeded",
      kind === "projection-bytes" || kind === "transcript-bytes" ? "extracted-text-bytes" : kind,
    );
  }
}

export function normalizeRecordedNvidiaIr(
  input: NvidiaRecordedInput,
  options: ParseOptions = {},
): NvidiaNormalizationResult {
  let rssArtifactHash = UNAVAILABLE_ARTIFACT_HASH;
  let releaseHtmlArtifactHash = UNAVAILABLE_ARTIFACT_HASH;
  const hashes: {
    -readonly [K in keyof NvidiaNormalizationTranscript]?: NvidiaNormalizationTranscript[K];
  } = {};
  try {
    const normalizedInput = snapshotNvidiaNormalizerInput(input);
    const normalizedOptions = snapshotNvidiaParseOptions(options);
    const { rssBytes, releaseHtmlBytes, selectionKey: rawSelectionKey } = normalizedInput;
    assertNvidiaRecordedMemberBounds(rssBytes, releaseHtmlBytes);
    rssArtifactHash = digest(rssBytes);
    releaseHtmlArtifactHash = digest(releaseHtmlBytes);
    const selectionKey = rawSelectionKey;
    const rss = parseRss(decode(rssBytes), selectionKey, normalizedOptions.rssChunkSize);
    hashes.rssItemProjectionHash = canonicalHash(
      "peas/nvidia-ir-rss-item-projection/v1",
      rss.projection as unknown as JsonValue,
    );
    const period = fiscalPeriod(rss.projection.title);
    if (period === null) {
      const reasonCode = "ir.not-financial-results";
      return {
        status: "ignored",
        reasonCode,
        transcript: transcript(
          "ignored",
          reasonCode,
          null,
          rssArtifactHash,
          releaseHtmlArtifactHash,
          hashes,
        ),
      };
    }
    const release = parseRelease(
      decode(releaseHtmlBytes),
      selectionKey,
      rss.projection.title,
      normalizedOptions.htmlChunkSize,
    );
    hashes.releaseVisibleProjectionHash = canonicalHash(
      "peas/nvidia-ir-release-visible-projection/v1",
      release as unknown as JsonValue,
    );
    const composite = {
      projectionVersion: 1,
      dialect: "peas-nvidia-newsroom-selected-composite-synthetic-v1",
      rssItemProjectionHash: hashes.rssItemProjectionHash,
      releaseVisibleProjectionHash: hashes.releaseVisibleProjectionHash,
    } as const;
    hashes.selectedProjectionHash = canonicalHash(
      "peas/provider-derived-content/v1",
      composite as unknown as JsonValue,
    );
    const publication =
      rss.projection.pubDate === null
        ? { publishedAtMs: null, timestampConfidence: "unknown" as const, originalTimestamp: null }
        : {
            publishedAtMs: rss.projection.pubDate.epochMs,
            timestampConfidence: "provider" as const,
            originalTimestamp: rss.projection.pubDate.originalTimestamp,
          };
    const recordHash = canonicalHash("peas/nvidia-ir-record-family/v1", {
      issuerCik: NVIDIA_ISSUER_CIK,
      title: rss.projection.title,
      itemPubDateOriginal: publication.originalTimestamp,
    });
    const revisionHash = canonicalHash("peas/nvidia-ir-revision/v1", {
      rssItemProjectionHash: hashes.rssItemProjectionHash,
      releaseVisibleProjectionHash: hashes.releaseVisibleProjectionHash,
    });
    const routeHash = canonicalHash("peas/nvidia-ir-recorded-route/v1", {
      classificationPolicy: "nvidia-financial-results-title-v1",
      issuerCik: NVIDIA_ISSUER_CIK,
      symbol: NVIDIA_SYMBOL,
      mappingAuthority: "peas-static-nvidia-v1",
      mappingVersion: "1",
      fiscalPeriod: period,
    });
    const candidate: NvidiaRecordedCandidateV1 = {
      candidateVersion: 1,
      provider: NVIDIA_IR_PROVIDER,
      source: NVIDIA_IR_SOURCE,
      sourceKind: "issuer_release",
      providerRecordId: `ir:nvidia:${recordHash}`,
      providerRevisionId: `sha256:${revisionHash}`,
      issuerCik: NVIDIA_ISSUER_CIK,
      symbol: NVIDIA_SYMBOL,
      fiscalPeriod: period,
      primaryArtifactHash: hashes.selectedProjectionHash,
      selectedProjectionHash: hashes.selectedProjectionHash,
      routeHash,
      ...publication,
    };
    hashes.candidateHash = canonicalHash(
      "peas/recorded-press-release-candidate/v1",
      candidate as unknown as JsonValue,
    );
    const subject = `earnings:${NVIDIA_ISSUER_CIK}:${period}`;
    const draft = validateEventDraft({
      envelopeVersion: 2,
      type: "earnings.source.observed",
      schemaVersion: 1,
      source: NVIDIA_IR_SOURCE,
      subject,
      occurredAtMs: publication.publishedAtMs,
      correlationId: subject,
      provider: {
        provider: NVIDIA_IR_PROVIDER,
        recordId: candidate.providerRecordId,
        revisionId: candidate.providerRevisionId,
        artifactHash: hashes.selectedProjectionHash,
      },
      payload: {
        issuerCik: NVIDIA_ISSUER_CIK,
        fiscalPeriod: period,
        sourceKind: "issuer_release",
        artifactHash: hashes.selectedProjectionHash,
        ...publication,
      },
    } satisfies EventDraft);
    hashes.eventDraftHash = canonicalHash(
      "peas/recorded-press-release-event-draft/v1",
      draft as unknown as JsonValue,
    );
    return {
      status: "emitted",
      candidate,
      draft,
      projections: { rssItem: rss.projection, releaseVisible: release },
      transcript: transcript(
        "emitted",
        null,
        null,
        rssArtifactHash,
        releaseHtmlArtifactHash,
        hashes,
      ),
    };
  } catch (error) {
    if (error instanceof ProviderNormalizerInputLimitError) {
      const contract = new NvidiaContractError("ir.member-limit-exceeded");
      return {
        status: "quarantined",
        reasonCode: contract.reasonCode,
        transcript: transcript(
          "quarantined",
          contract.reasonCode,
          contract.limitKind,
          rssArtifactHash,
          releaseHtmlArtifactHash,
          hashes,
        ),
      };
    }
    const contract =
      error instanceof NvidiaContractError
        ? error
        : error instanceof ProviderNormalizerInputError
          ? new NvidiaContractError("ir.bundle-invalid")
          : new NvidiaContractError("ir.release-malformed");
    return {
      status: "quarantined",
      reasonCode: contract.reasonCode,
      transcript: transcript(
        "quarantined",
        contract.reasonCode,
        contract.limitKind,
        rssArtifactHash,
        releaseHtmlArtifactHash,
        hashes,
      ),
    };
  }
}
