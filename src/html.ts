/**
 * HTML 内容的保护。
 *
 * Tower 把任务的 `desc`、评论正文当 **HTML** 处理，会过一遍白名单清洗。
 * 关键行为：**白名单之外的标签不是被转义，而是被整个删掉**。
 *
 * 实测（`<b>` 这类保留，其余消失）：
 *
 *   发送 `access_token=<token>&contactId=<MK>`
 *   存回 `access_token=&amp;contactId=`      ← `<token>` 和 `<MK>` 没了
 *
 * 这对 QA 报告这类「复现步骤里带尖括号占位符」的内容是致命的：写的时候看着没问题，
 * 存进去就少了一段，而且**不报错**。
 *
 * 所以这里把白名单之外的标签主动转义成 `&lt;xxx&gt;`——它们在 Tower 那边反正会被删，
 * 转义后反而能作为字面量显示出来，是严格更优的结果。转义了哪些会在工具结果里报出来，
 * 不搞静默修改。
 *
 * 白名单是**实测**得到的，不是照抄某个 sanitizer 的文档。
 */

/** 实测 Tower 会保留的标签（40 个）。改动前请重新实测，别凭印象加减 */
export const ALLOWED_TAGS = new Set([
  // 段落与换行
  'p', 'br', 'hr', 'div', 'span',
  // 标题
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // 强调
  'b', 'strong', 'i', 'em', 'big', 'tt', 'small', 'sub', 'sup', 'del', 'ins',
  // 列表
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // 引用与代码
  'blockquote', 'pre', 'code', 'samp', 'kbd', 'var',
  // 链接与图片
  'a', 'img',
  // 其他被保留的
  'address', 'abbr', 'acronym', 'cite',
]);

export interface ProtectResult {
  /** 转义后的文本 */
  text: string;
  /** 被转义的标签名（去重，保留出现顺序） */
  escaped: string[];
}

/**
 * 把 Tower 会删掉的标签转义成字面量。
 *
 * 只处理 `<name>`、`</name>`、`<name ...>` 这种**形如标签**的片段；
 * 单独出现的 `<`（如「值 < 5」）不动，Tower 自己会转义它。
 */
export function protectUnknownTags(html: string): ProtectResult {
  const escaped: string[] = [];
  const seen = new Set<string>();

  const text = html.replace(
    /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (match, slash: string, name: string) => {
      if (ALLOWED_TAGS.has(name.toLowerCase())) return match;
      if (!seen.has(name)) {
        seen.add(name);
        escaped.push(name);
      }
      // 整个标签转义，内容原样保留（含属性）
      return `&lt;${match.slice(1, -1)}&gt;`;
    },
  );

  return { text, escaped };
}

/** 只检测不修改：列出会被 Tower 删掉的标签 */
export function findStrippedTags(html: string): string[] {
  return protectUnknownTags(html).escaped;
}

/**
 * 保护一个 HTML 字段，直接给工具处理器用。
 * 返回处理后的文本 + 要附在结果里的说明（没有风险标签时为 null）。
 */
export function protectHtmlField(html: string | undefined): {
  text: string | undefined;
  note: string | null;
} {
  if (html === undefined) return { text: undefined, note: null };
  const { text, escaped } = protectUnknownTags(html);
  return { text, note: htmlProtectionNote(escaped) };
}

/** 给工具结果用的提示语；没有风险标签时返回 null */
export function htmlProtectionNote(escaped: readonly string[]): string | null {
  if (escaped.length === 0) return null;
  const list = escaped.map((t) => `<${t}>`).join('、');
  return (
    `注意：描述里出现了 ${list}。Tower 会把 desc / 评论当 HTML 清洗，` +
    '**白名单外的标签会被整个删掉**（不是转义），所以这些已经自动转义成 ' +
    '&lt;xxx&gt; 以保证原样显示。如果你本来就想用 HTML 标签，' +
    '请确认它在 Tower 支持的白名单内。'
  );
}

/** 白名单标签的列举，用在工具描述里 */
export const ALLOWED_TAGS_HINT =
  'p br hr div span h1-h6 b strong i em big tt small sub sup del ins ul ol li dl dt dd ' +
  'blockquote pre code samp kbd var a img address abbr acronym cite';

/**
 * 所有「内容是 HTML」的字段共用的描述。
 *
 * 这段要写得显眼：`<token>` 被吞是**静默**的——写的时候看不出问题，
 * 存进去少一段，不报错。踩过一次就会反复踩，所以宁可啰嗦。
 */
export const HTML_FIELD_DESC =
  '支持 HTML。**但 Tower 只认一份固定白名单，白名单外的标签会被整个删掉（不是转义）**——' +
  '包括 `<token>`、`<MK>` 这类占位符，以及 `<table>`、`<video>`、`<u>`、`<mark>`、`<font>`。' +
  `白名单：${ALLOWED_TAGS_HINT}。` +
  '本服务会在发送前把白名单外的标签**自动转义**成字面量（并在结果里说明转义了什么），' +
  '所以直接写 `<token>` 是安全的、能正常显示；' +
  '但若确实想用 HTML 排版，请只用上面白名单里的标签，否则会被转义成字面量显示。';
