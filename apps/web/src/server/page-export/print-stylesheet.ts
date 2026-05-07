// Single fixed stylesheet shared by HTML download and PDF render.
// Rules: documental layout (800px wide, system font), branded blocks
// (callout fills, code highlighting, table borders), page-break hints.

export const PRINT_STYLESHEET = `
:root {
  color-scheme: light;
}
* { box-sizing: border-box; }

body {
  margin: 0;
  background: #fff;
  color: #1f2937;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  font-size: 14px;
  line-height: 1.55;
}

body > * { max-width: 800px; margin-left: auto; margin-right: auto; padding: 0 24px; }

.document-title {
  font-size: 28px;
  font-weight: 600;
  margin: 32px auto 16px;
}

h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  margin: 1.4em 0 0.4em;
  page-break-after: avoid;
  break-after: avoid;
}
h1 { font-size: 28px; }
h2 { font-size: 22px; }
h3 { font-size: 18px; }
h4 { font-size: 16px; }
h5 { font-size: 15px; }
h6 { font-size: 14px; }

p, ul, ol, blockquote { margin: 0.4em 0; }
ul, ol { padding-left: 1.6em; }
li { margin: 0.2em 0; line-height: 1.5; }

ul[data-type="taskList"] { list-style: none; padding-left: 0.4em; }
ul[data-type="taskList"] > li { display: flex; align-items: flex-start; gap: 0.6em; }
ul[data-type="taskList"] input[type="checkbox"] { margin: 0.3em 0 0; }

blockquote {
  border-left: 3px solid #cbd5e1;
  padding: 0.2em 0.8em;
  margin: 0.6em 0;
  color: #475569;
}

pre {
  background: #f1f5f9;
  padding: 12px 14px;
  border-radius: 6px;
  overflow: auto;
  font-size: 13px;
  page-break-inside: avoid;
  break-inside: avoid;
}
pre code { font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; }
:not(pre) > code {
  background: #f1f5f9;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.92em;
}

.hljs-keyword, .hljs-built_in { color: #cf222e; }
.hljs-string, .hljs-attr { color: #0a3069; }
.hljs-number, .hljs-literal { color: #0550ae; }
.hljs-comment { color: #6e7781; font-style: italic; }
.hljs-title, .hljs-function, .hljs-class { color: #8250df; }
.hljs-tag { color: #116329; }

table {
  border-collapse: collapse;
  margin: 0.6em 0;
  width: 100%;
}
th, td {
  border: 1px solid #cbd5e1;
  padding: 6px 10px;
  vertical-align: top;
}
th { background: #f8fafc; font-weight: 600; }
tr { page-break-inside: avoid; break-inside: avoid; }

img {
  max-width: 100%;
  height: auto;
  page-break-inside: avoid;
  break-inside: avoid;
}

a { color: #2563eb; text-decoration: underline; }

.anynote-bg-gray { background-color: rgba(107, 107, 107, 0.12); }
.anynote-bg-brown { background-color: rgba(138, 93, 61, 0.14); }
.anynote-bg-orange { background-color: rgba(180, 83, 9, 0.14); }
.anynote-bg-yellow { background-color: rgba(161, 98, 7, 0.14); }
.anynote-bg-green { background-color: rgba(52, 125, 71, 0.14); }
.anynote-bg-blue { background-color: rgba(26, 107, 179, 0.14); }
.anynote-bg-purple { background-color: rgba(107, 63, 160, 0.14); }
.anynote-bg-pink { background-color: rgba(181, 51, 142, 0.14); }
.anynote-bg-red { background-color: rgba(180, 35, 24, 0.14); }

[class*="anynote-bg-"] {
  padding: 2px 6px;
  border-radius: 4px;
}

:is(p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote)[class*="anynote-bg-"] {
  display: table;
  max-width: 100%;
}

[data-type="callout"] {
  display: flex;
  gap: 10px;
  background: #f1f5f9;
  border-radius: 6px;
  padding: 10px 14px;
  margin: 0.6em 0;
  page-break-inside: avoid;
  break-inside: avoid;
}
[data-type="callout"]::before {
  content: attr(data-emoji);
  flex: 0 0 auto;
  font-size: 18px;
  line-height: 1.4;
}
[data-type="callout"] > * { margin: 0.15em 0; }

[data-type="toggle"] {
  margin: 0.5em 0;
  padding-left: 18px;
  border-left: 2px solid #e2e8f0;
}

[data-type="hiddenText"], .hidden-text {
  background: #fef9c3;
  padding: 0 2px;
  border-radius: 2px;
}

[data-type="file-attachment"] {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 12px;
  margin: 0.5em 0;
  text-decoration: none;
  color: inherit;
  page-break-inside: avoid;
  break-inside: avoid;
}
[data-type="file-attachment"]::before {
  content: "📎";
  font-size: 18px;
}
[data-type="file-attachment"]::after {
  content: attr(data-name);
  font-weight: 500;
}

@page { size: A4; margin: 0; }
`
