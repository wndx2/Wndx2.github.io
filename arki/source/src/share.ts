// A whole graph in a link: the expressions, how the graph is drawn and the part of the
// plane on show, compressed into the part of the URL after `#graph=`. Nothing is sent
// anywhere; the link carries everything.

import type { Bounds } from './graph/Graph';
import type { GraphSettings } from './graph/render';
import type { Expression } from './ui/ExpressionRow';

export interface SharedGraph {
  expressions: Expression[];
  settings: Partial<GraphSettings>;
  bounds?: Bounds;
  // How much longer a unit of y is drawn than a unit of x.
  aspect?: number;
}

const KEY = 'graph=';
const VERSION = 1;

const toBase64Url = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string) => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

// `z` marks compressed data; `j` plain JSON, for a browser without compression streams.
export async function encodeGraph(graph: SharedGraph): Promise<string> {
  // A playing slider starts still when the link is opened.
  const expressions = graph.expressions.map(({ playing: _, ...rest }) => rest);
  const { xStepValue: _x, yStepValue: _y, ...settings } = graph.settings;
  const json = new TextEncoder().encode(JSON.stringify({ v: VERSION, ...graph, expressions, settings }));
  if (typeof CompressionStream === 'undefined') return `j${toBase64Url(json)}`;
  return `z${toBase64Url(await through(json, new CompressionStream('deflate-raw')))}`;
}

export async function decodeGraph(text: string): Promise<SharedGraph | undefined> {
  try {
    let bytes: Uint8Array = fromBase64Url(text.slice(1));
    if (text[0] === 'z') bytes = await through(bytes, new DecompressionStream('deflate-raw'));
    else if (text[0] !== 'j') return undefined;
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(data?.expressions) || data.expressions.length === 0) return undefined;
    return {
      expressions: data.expressions,
      settings: typeof data.settings === 'object' && data.settings ? data.settings : {},
      bounds: data.bounds,
      aspect: typeof data.aspect === 'number' ? data.aspect : undefined,
    };
  } catch {
    // A link that was cut short or edited by hand is just not a graph.
    return undefined;
  }
}

// The graph's data in this page's address, if it was opened from a shared link.
export const sharedInLocation = () => {
  const hash = window.location.hash.slice(1);
  return hash.startsWith(KEY) ? hash.slice(KEY.length) : undefined;
};

export const linkTo = (encoded: string) => `${window.location.origin}${window.location.pathname}#${KEY}${encoded}`;
