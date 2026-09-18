import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

marked.setOptions({ breaks: true, gfm: true });

function highlight(code: string, lang?: string): string {
  try {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
    return hljs.highlightAuto(code).value;
  } catch { return code.replace(/</g, '&lt;'); }
}

// Render chat markdown safely: marked -> highlight code -> DOMPurify.
// Links open externally via the desktop shell (target _blank + rel).
export function renderMarkdown(src: string): string {
  const withHl = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const html = highlight(code.replace(/\n$/, ''), lang || undefined);
    return `<pre class="codeblock"><code class="hljs ${lang ? `language-${lang}` : ''}">${html}</code></pre>`;
  });
  const raw = marked.parse(withHl, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
  }).replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}

export function mentionsOf(content: string): string[] {
  const out: string[] = [];
  const re = /@([a-zA-Z0-9_.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) out.push(m[1].toLowerCase());
  return out;
}
