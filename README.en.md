# MarkTeX Copy

<img src="icons/icon128.png" width="64" align="right" alt="MarkTeX Copy">

[简体中文](README.md) | English

A Chrome / Edge extension that copies selections from web pages and PDFs as **Markdown** or **HTML**, keeping formulas as **LaTeX**.

<p>
  <img src="docs/popup-light-en.png" width="280" alt="Light mode">
  <img src="docs/popup-dark.png" width="280" alt="Dark mode">
</p>

## Install

1. Download the zip from [Releases](https://github.com/GetawayCar1024/marktex-copy/releases) and unzip it
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**
3. Click **Load unpacked** and choose the unzipped folder

To copy from local files (`file://`), also turn on **Allow access to file URLs** in the extension details.

## Usage

- **Context menu**: copy as Markdown / HTML (rich text) / HTML source; right-click a formula to copy just its LaTeX
- **Shortcuts**: `Alt+Shift+M` (Markdown) and `Alt+Shift+H` (HTML) by default, changeable in the popup. They only act on a selection, so `Ctrl+C` works too
- **Popup**: copy, preview, and settings such as formula delimiters, the PDF image size limit and language

## Formulas

| Source | Typical sites |
| --- | --- |
| KaTeX | ChatGPT, Claude, DeepSeek, Notion, Luogu (HTML-only output is rebuilt from layout) |
| MathJax v2 / v3 / v4 | Stack Exchange, GitHub, blogs |
| MathML | arXiv, Wikipedia |
| `data-tex` attributes, image `alt` | Zhihu, Gemini |

Partial selections expand to whole formulas. In HTML, formulas can be LaTeX or MathML (editable in Word).

## PDF

The browser's PDF viewer doesn't let extensions read the selection, so a [PDF.js](https://github.com/mozilla/pdf.js) reader is bundled:

- PDFs still open in the browser's viewer; copying there prompts you to switch instead of copying plain text
- The reader shares the popup's style and follows the system light / dark theme; the sidebar switches between page thumbnails, the outline and more
- Copying rebuilds paragraphs, headings, nested lists, bold, code blocks, ruled tables and images (images can be selected on their own and are copied inline), and turns formulas into LaTeX (scripts, sum limits, fractions, roots, multi-line equations). Formulas are inferred from the layout, so please check them
- Inline images over the size limit (100 KB by default) are compressed; change the limit or turn it off in the popup
- PDFs exported via MathJax (e.g. Typora, where formulas are vector shapes; exported on Windows or macOS) are recognized too; TeX in outline titles is shown as math
- Line numbers beside code blocks and samples aren't copied (including samples typeset with LaTeX listings); tables split across pages are merged; running headers / footers and content hidden at page breaks are dropped
- `Ctrl+A` selects only the PDF content and reads every page, no scrolling needed

## Notes

- Brackets are not backslash-escaped (`\[ \]` means math in many editors)
- CSS-styled bold, italics and headings are recognized; emphasis dots count as bold
- Code blocks without a language get one guessed from common patterns (C/C++, Python, Java, …)
- Doesn't work on browser pages or web stores; scanned PDFs have no text to copy

## License

MIT. The bundled PDF.js is licensed under Apache License 2.0; `src/mathjax-glyphs.js` is generated from MathJax fonts (Apache License 2.0); the icon is based on the Markdown mark (Dustin Curtis, CC0).
